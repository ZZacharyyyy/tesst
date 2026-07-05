/**
 * Cloudflare Worker — keeps the Discord webhook URL out of the browser entirely.
 *
 * The page POSTs the current vote tally (and which OS was just picked) to this
 * Worker. The Worker reads the real webhook URL from an encrypted secret
 * (env.DISCORD_WEBHOOK_URL) that is never sent to the client, formats the
 * Discord message, and posts it server-side.
 *
 * DEPLOY:
 * 1. Go to https://dash.cloudflare.com -> Workers & Pages -> Create -> Worker.
 * 2. Replace the default code with this file, then Deploy.
 * 3. Go to the Worker's Settings -> Variables -> Add secret:
 *      name:  DISCORD_WEBHOOK_URL
 *      value: https://discord.com/api/webhooks/1523275953348935770/26Hzky-JQlpaPS4oSjv8jgqlOKWk3fZ26jssznimIDP6knL_jQ92k5xRwV0YHrIEtMqBl
 *    (Secrets are encrypted at rest and are never visible in the dashboard
 *    again after you save them, and never sent to any browser.)
 * 4. Copy the Worker's URL (looks like https://os-survey.<you>.workers.dev)
 *    and paste it into WORKER_URL in os-survey.html.
 *
 * Optional: restrict ALLOWED_ORIGIN below to your actual site's origin once
 * you know it, instead of "*", so only your page can call this Worker.
 */

const ALLOWED_ORIGIN = "*"; // e.g. "https://yoursite.pages.dev"

export default {
	async fetch(request, env) {
		const corsHeaders = {
			"Access-Control-Allow-Origin": ALLOWED_ORIGIN,
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type"
		};

		if (request.method === "OPTIONS") {
			return new Response(null, { headers: corsHeaders });
		}

		if (request.method !== "POST") {
			return json({ error: "Method not allowed" }, 405, corsHeaders);
		}

		if (!env.DISCORD_WEBHOOK_URL) {
			return json({ error: "Server missing DISCORD_WEBHOOK_URL secret" }, 500, corsHeaders);
		}

		let body;
		try {
			body = await request.json();
		} catch {
			return json({ error: "Invalid JSON body" }, 400, corsHeaders);
		}

		const { tally, votedLabel } = body || {};
		if (!tally || typeof tally !== "object") {
			return json({ error: "Missing or invalid 'tally'" }, 400, corsHeaders);
		}

		const content = buildDiscordMessage(tally, votedLabel);

		let discordRes;
		try {
			discordRes = await fetch(env.DISCORD_WEBHOOK_URL, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ content })
			});
		} catch {
			return json({ error: "Could not reach Discord" }, 502, corsHeaders);
		}

		if (!discordRes.ok) {
			return json({ error: `Discord responded with ${discordRes.status}` }, 502, corsHeaders);
		}

		return json({ ok: true }, 200, corsHeaders);
	}
};

function json(obj, status, extraHeaders) {
	return new Response(JSON.stringify(obj), {
		status,
		headers: { "Content-Type": "application/json", ...extraHeaders }
	});
}

function buildDiscordMessage(tally, votedLabel) {
	const entries = Object.entries(tally)
		.filter(([, count]) => Number(count) > 0)
		.sort((a, b) => b[1] - a[1]);

	if (entries.length === 0) return "No votes yet.";

	const total = entries.reduce((sum, [, c]) => sum + Number(c), 0);
	const max = Math.max(...entries.map(([, c]) => Number(c)), 1);
	const barWidth = 20;
	const nameWidth = Math.max(...entries.map(([name]) => name.length), 4);

	const lines = entries.map(([name, count]) => {
		const filled = Math.round((Number(count) / max) * barWidth);
		const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
		return `${name.padEnd(nameWidth)} ${bar} ${count}`;
	});

	const header = votedLabel
		? `**${votedLabel}** just voted. Current OS tally:\n`
		: "Current OS tally:\n";

	return header + "```\n" + lines.join("\n") + `\n\nTotal votes: ${total}\n` + "```";
}
