// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Email sending via Cloudflare Email Service REST API.
 *
 * The Workers `send_email` binding only delivers to verified Destination
 * Addresses. Transactional mail (invites, password reset) needs arbitrary
 * recipients → POST /accounts/{account_id}/email/sending/send.
 *
 * See: https://developers.cloudflare.com/email-service/api/send-emails/rest-api/
 */

export interface SendEmailParams {
	to: string | string[];
	from: string | { email: string; name: string };
	subject: string;
	html?: string;
	text?: string;
	cc?: string | string[];
	bcc?: string | string[];
	replyTo?: string | { email: string; name: string };
	attachments?: {
		content: string; // base64 encoded
		filename: string;
		type: string;
		disposition: "attachment" | "inline";
		contentId?: string;
	}[];
	headers?: Record<string, string>;
}

export type EmailSendEnv = {
	EMAIL_API_TOKEN: string;
	CF_ACCOUNT_ID: string;
};

export class EmailSendError extends Error {
	readonly code: string;
	readonly status: number;
	constructor(message: string, code: string, status: number) {
		super(message);
		this.name = "EmailSendError";
		this.code = code;
		this.status = status;
	}
}

function fromAddress(from: SendEmailParams["from"]): string {
	return typeof from === "string" ? from : from.email;
}

/**
 * Send an email using the Cloudflare Email Sending REST API.
 *
 * @throws EmailSendError on validation / API / network failure
 */
export async function sendEmail(
	env: EmailSendEnv,
	params: SendEmailParams,
): Promise<{ messageId: string }> {
	const token = String(env.EMAIL_API_TOKEN || "").trim();
	const accountId = String(env.CF_ACCOUNT_ID || "").trim();
	if (!token) {
		throw new EmailSendError("EMAIL_API_TOKEN em falta", "config", 503);
	}
	if (!accountId) {
		throw new EmailSendError("CF_ACCOUNT_ID em falta", "config", 503);
	}

	const body: Record<string, unknown> = {
		to: params.to,
		from: fromAddress(params.from),
		subject: params.subject,
	};
	if (params.html) body.html = params.html;
	if (params.text) body.text = params.text;
	if (params.cc) body.cc = params.cc;
	if (params.bcc) body.bcc = params.bcc;
	if (params.replyTo) {
		body.reply_to =
			typeof params.replyTo === "string" ? params.replyTo : params.replyTo.email;
	}
	if (params.headers && Object.keys(params.headers).length > 0) {
		body.headers = params.headers;
	}
	if (params.attachments && params.attachments.length > 0) {
		body.attachments = params.attachments.map((att) => ({
			content: att.content,
			filename: att.filename,
			type: att.type,
			disposition: att.disposition,
			...(att.contentId ? { content_id: att.contentId } : {}),
		}));
	}

	const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`;
	let res: Response;
	try {
		res = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});
	} catch {
		throw new EmailSendError("Falha de rede ao contactar Email Sending", "network", 502);
	}

	let json: {
		success?: boolean;
		errors?: Array<{ code?: number | string; message?: string }>;
		result?: { message_id?: string; messageId?: string; delivered?: string[] };
	} | null = null;
	try {
		json = (await res.json()) as typeof json;
	} catch {
		json = null;
	}

	if (!res.ok || json?.success === false) {
		const err0 = json?.errors?.[0];
		const msg =
			err0?.message ||
			`Email Sending respondeu ${res.status}`;
		const code = err0?.code != null ? String(err0.code) : "email_sending";
		const status =
			res.status === 401 || res.status === 403
				? 503
				: res.status === 429
					? 429
					: res.status >= 400 && res.status < 500
						? 400
						: 502;
		throw new EmailSendError(msg, code, status);
	}

	const messageId =
		json?.result?.messageId ||
		json?.result?.message_id ||
		(Array.isArray(json?.result?.delivered) && json!.result!.delivered![0]) ||
		crypto.randomUUID();

	return { messageId: String(messageId) };
}
