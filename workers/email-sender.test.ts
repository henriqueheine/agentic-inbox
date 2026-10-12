// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { EmailSendError, sendEmail } from "./email-sender.ts";

describe("sendEmail REST", () => {
	it("exige EMAIL_API_TOKEN e CF_ACCOUNT_ID", async () => {
		await assert.rejects(
			() =>
				sendEmail(
					{ EMAIL_API_TOKEN: "", CF_ACCOUNT_ID: "acct" },
					{ to: "a@b.com", from: "no-reply@laudomaker.com.br", subject: "x", text: "y" },
				),
			(e: unknown) => e instanceof EmailSendError && e.code === "config",
		);
		await assert.rejects(
			() =>
				sendEmail(
					{ EMAIL_API_TOKEN: "tok", CF_ACCOUNT_ID: "" },
					{ to: "a@b.com", from: "no-reply@laudomaker.com.br", subject: "x", text: "y" },
				),
			(e: unknown) => e instanceof EmailSendError && e.code === "config",
		);
	});

	it("propaga erro da API (success:false)", async () => {
		const fetchMock = mock.method(globalThis, "fetch", async () =>
			new Response(
				JSON.stringify({
					success: false,
					errors: [{ code: 10105, message: "account not entitled" }],
				}),
				{ status: 403 },
			),
		);
		try {
			await assert.rejects(
				() =>
					sendEmail(
						{ EMAIL_API_TOKEN: "tok", CF_ACCOUNT_ID: "acct" },
						{
							to: "registroheine@gmail.com",
							from: "no-reply@laudomaker.com.br",
							subject: "Convite",
							text: "olá",
							html: "<p>olá</p>",
						},
					),
				(e: unknown) =>
					e instanceof EmailSendError &&
					e.message === "account not entitled" &&
					e.code === "10105" &&
					e.status === 503,
			);
			assert.equal(fetchMock.mock.callCount(), 1);
			const [url, init] = fetchMock.mock.calls[0].arguments as [string, RequestInit];
			assert.match(url, /\/accounts\/acct\/email\/sending\/send$/);
			assert.equal((init.headers as Record<string, string>).Authorization, "Bearer tok");
			const posted = JSON.parse(String(init.body));
			assert.equal(posted.from, "no-reply@laudomaker.com.br");
			assert.equal(posted.to, "registroheine@gmail.com");
			assert.equal(posted.subject, "Convite");
			assert.equal(posted.text, "olá");
			assert.equal(posted.html, "<p>olá</p>");
		} finally {
			fetchMock.mock.restore();
		}
	});

	it("sucesso devolve messageId", async () => {
		const fetchMock = mock.method(globalThis, "fetch", async () =>
			new Response(
				JSON.stringify({
					success: true,
					result: { message_id: "mid-1", delivered: ["registroheine@gmail.com"] },
				}),
				{ status: 200 },
			),
		);
		try {
			const out = await sendEmail(
				{ EMAIL_API_TOKEN: "tok", CF_ACCOUNT_ID: "acct" },
				{
					to: "registroheine@gmail.com",
					from: { email: "no-reply@laudomaker.com.br", name: "Laudomaker" },
					subject: "Convite",
					text: "olá",
				},
			);
			assert.equal(out.messageId, "mid-1");
		} finally {
			fetchMock.mock.restore();
		}
	});
});
