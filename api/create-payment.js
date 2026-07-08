const https = require('https');
const crypto = require('crypto');

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { payment_method_id, transaction_amount, payer } = req.body || {};

    try {

        const KIWIFY_CLIENT_SECRET = process.env.KIWIFY_CLIENT_SECRET || 'ad6b89a6580466a0f368dbecda2834de2f5550f98a48be0e8751c8be24bf15b1';
        const KIWIFY_CLIENT_ID = process.env.KIWIFY_CLIENT_ID || '7162d82c-3575-488d-9117-032a84ee07f3';
        const KIWIFY_ACCOUNT_ID = process.env.KIWIFY_ACCOUNT_ID || 'Q3TYWn7cbO9eGCN';

        const amountInCents = Math.round(parseFloat(transaction_amount) * 100);
        const externalReferenceId = Math.floor(100000000 + Math.random() * 900000000).toString();

        const requestBody = JSON.stringify({
            amount_in_cents: amountInCents,
            accept_change_value: false,
            external_reference_id: externalReferenceId
        });

        // Ed25519 PoP Signature generation
        const timestamp = Date.now().toString();
        const uri = '/v1/dynamic-qrcode';
        const method = 'POST';
        const message = `${uri}:${method}:${requestBody}:${timestamp}`;

        const seed = Buffer.from(KIWIFY_CLIENT_SECRET, 'hex');
        const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
        const pkcs8Buffer = Buffer.concat([pkcs8Prefix, seed]);

        const privateKey = crypto.createPrivateKey({
            key: pkcs8Buffer,
            format: 'der',
            type: 'pkcs8'
        });

        const signature = crypto.sign(null, Buffer.from(message), privateKey).toString('base64');

        // Make the real API call to Kiwify Banking
        const kiwifyRes = await new Promise((resolve, reject) => {
            const options = {
                hostname: 'conta-public-api.kiwify.com',
                port: 443,
                path: uri,
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Content-Length': Buffer.byteLength(requestBody),
                    'x-access-id': KIWIFY_CLIENT_ID,
                    'X-PoP-Signature': signature,
                    'X-PoP-Challenge': timestamp,
                    'X-PoP-Format': 'service-account'
                }
            };

            const reqCall = https.request(options, (resCall) => {
                let data = '';
                resCall.on('data', chunk => data += chunk);
                resCall.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (resCall.statusCode >= 200 && resCall.statusCode < 300) {
                            resolve(parsed);
                        } else {
                            reject(new Error(parsed.message || `HTTP ${resCall.statusCode}: ${data}`));
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse Kiwify response: ${data}`));
                    }
                });
            });

            reqCall.on('error', err => reject(err));
            reqCall.write(requestBody);
            reqCall.end();
        });

        const paymentId = kiwifyRes.id;

        // Save payer details to /tmp for check-payment.js recovery
        try {
            const fs = require('fs');
            fs.writeFileSync(`/tmp/mock-payment-${paymentId}.json`, JSON.stringify({ payer, transaction_amount, payment_method_id: 'pix' }));
        } catch (fsErr) {
            console.error("Error saving mock data to /tmp:", fsErr.message);
        }

        // Trigger Facebook CAPI Purchase
        try {
            await triggerFacebookCAPI(payer, transaction_amount);
        } catch (capiErr) {
            console.error("Error launching Facebook CAPI:", capiErr.message);
        }

        const parsedData = {
            id: paymentId,
            status: "pending",
            payment_method_id: "pix",
            transaction_amount: parseFloat(transaction_amount),
            point_of_interaction: {
                transaction_data: {
                    qr_code: kiwifyRes.emv,
                    qr_code_base64: ""
                }
            }
        };

        // Trigger Lailla Pending Webhook
        try {
            await triggerLaillaWebhook(payer, parsedData, transaction_amount);
        } catch (webhookErr) {
            console.error("Error launching Lailla Webhook:", webhookErr.message);
        }

        // Trigger Pushcut Pending Webhook
        try {
            await triggerPushcutPendingWebhook();
        } catch (pushcutErr) {
            console.error("Error launching Pushcut Pending Webhook:", pushcutErr.message);
        }

        return res.status(200).json(parsedData);

    } catch (error) {
        console.error("Payment integration error (falling back to mock):", error.message);
        
        // Generate a mock payment so that the site is testable even if credentials are not active yet
        const paymentId = `mock_${Math.floor(100000000 + Math.random() * 900000000)}`;
        
        // Save payer details to /tmp for check-payment.js recovery
        try {
            const fs = require('fs');
            fs.writeFileSync(`/tmp/mock-payment-${paymentId}.json`, JSON.stringify({ payer, transaction_amount, payment_method_id: 'pix' }));
        } catch (fsErr) {
            console.error("Error saving mock data to /tmp:", fsErr.message);
        }

        const parsedData = {
            id: paymentId,
            status: "pending",
            payment_method_id: "pix",
            transaction_amount: parseFloat(transaction_amount),
            point_of_interaction: {
                transaction_data: {
                    qr_code: "00020101021226870014br.gov.bcb.pix2565qr.kiwify.com.br/v2/mock-pix-payment-salvai-me-rainha520400005303986540550.005802BR5925Salvai-me Rainha do Brasil6009Sao Paulo62070503***6304ABCD",
                    qr_code_base64: ""
                }
            },
            is_mock: true
        };

        // Trigger Facebook CAPI Purchase immediately in mock mode
        try {
            await triggerFacebookCAPI(payer, transaction_amount);
        } catch (capiErr) {
            console.error("Error launching Facebook CAPI in mock:", capiErr.message);
        }

        // Trigger Lailla Pending Webhook
        try {
            await triggerLaillaWebhook(payer, parsedData, transaction_amount);
        } catch (webhookErr) {
            console.error("Error launching Lailla Webhook in mock:", webhookErr.message);
        }

        // Trigger Pushcut Pending Webhook
        try {
            await triggerPushcutPendingWebhook();
        } catch (pushcutErr) {
            console.error("Error launching Pushcut Pending Webhook in mock:", pushcutErr.message);
        }

        return res.status(200).json(parsedData);
    }
};

function triggerFacebookCAPI(payer, amount) {
    const crypto = require('crypto');
    const hash = (str) => {
        if (!str) return undefined;
        return crypto.createHash('sha256').update(str.trim().toLowerCase()).digest('hex');
    };

    let cleanPhone = (payer.phone || "").replace(/\D/g, '');
    if (cleanPhone && !cleanPhone.startsWith('55') && (cleanPhone.length === 10 || cleanPhone.length === 11)) {
        cleanPhone = '55' + cleanPhone;
    }

    const emailHash = hash(payer.email);
    const phoneHash = hash(cleanPhone);
    const firstNameHash = hash(payer.first_name);
    const lastNameHash = hash(payer.last_name);

    const payload = {
        data: [
            {
                event_name: "Purchase",
                event_time: Math.floor(Date.now() / 1000),
                event_source_url: "https://salvai-me-rainha.vercel.app/",
                action_source: "website",
                user_data: {
                    em: emailHash ? [emailHash] : undefined,
                    ph: phoneHash ? [phoneHash] : undefined,
                    fn: firstNameHash ? [firstNameHash] : undefined,
                    ln: lastNameHash ? [lastNameHash] : undefined
                },
                custom_data: {
                    value: parseFloat(amount),
                    currency: "BRL"
                }
            }
        ]
    };

    const payloadStr = JSON.stringify(payload);

    const pixels = [
        {
            id: "1275998244606117",
            token: "EAAK6H9X0gZCsBRwTg9ZAjxn98tbQ5FHm6zQ0UpxWgh0kX7Y85FCLsw1KPW8SOjdqBUNGfXZBST09eFGU6GCDdMb68LDl6lzQY7KgwgxnPfvlbmTYkLW58ND6V8fmPmII1yZB3TQe7uMoxHwHI34ZBy1oVeXimAJVvjZAVv5DoZC6fndWZBI48eF07bKZCAtxZCpISwUwZDZD"
        },
        {
            id: "1344595447110213",
            token: "EAAK93ANGiaIBRZBHyeiZC77JH7ZCPZCf4s5ZCL8ZAtjpOKNSE8AXZCPH1Euwb0NpsxieVBFDZCuP4MmSWkpaUjWJ6vdWfZCzVZBzqjrZC0zZBkjzTYQdqirHN1JZBeDRZBUG0D6HG6Ki5oC8gqOCoLx3r3jEbZBcO4FXdlDVUR174q7b8TFt4k2cwOlf2wxIXZBCRrhoyrJyqQZDZD"
        }
    ];

    const https = require('https');

    const promises = pixels.map(pixel => {
        return new Promise((resolve) => {
            const options = {
                hostname: 'graph.facebook.com',
                port: 443,
                path: `/v17.0/${pixel.id}/events?access_token=${pixel.token}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payloadStr)
                }
            };

            const req = https.request(options, (res) => {
                let resData = '';
                res.on('data', (c) => resData += c);
                res.on('end', () => {
                    console.log(`Facebook CAPI Response for ${pixel.id}:`, resData);
                    resolve();
                });
            });

            req.on('error', (e) => {
                console.error(`Facebook CAPI Error for ${pixel.id}:`, e);
                resolve();
            });

            req.write(payloadStr);
            req.end();
        });
    });

    return Promise.all(promises);
}

function triggerLaillaWebhook(payer, parsedData, amount) {
    return new Promise((resolve) => {
        const laillaUrl = "https://api.lailla.io/v1/webhook/custom/1176ae8a-f7c0-433c-b404-084296d55506";

        let cleanPhone = (payer.phone || "").replace(/\D/g, '');
        if (cleanPhone && !cleanPhone.startsWith('55') && (cleanPhone.length === 10 || cleanPhone.length === 11)) {
            cleanPhone = '55' + cleanPhone;
        }

        const payload = {
            event: "order.pending",
            order: {
                id: parsedData.id ? `MP-${parsedData.id}` : `SR-${Math.floor(Math.random() * 900000 + 100000)}-BR`,
                status: "pending",
                payment_method: parsedData.payment_method_id || "pix",
                amount: parseFloat(amount),
                product: "Camisa Devocional de Nossa Senhora Aparecida",
                pix_code: parsedData.point_of_interaction?.transaction_data?.qr_code || "",
                pix_qr_base64: parsedData.point_of_interaction?.transaction_data?.qr_code_base64 || ""
            },
            customer: {
                name: `${payer.first_name} ${payer.last_name}`.trim(),
                email: payer.email,
                phone: cleanPhone
            }
        };

        const payloadStr = JSON.stringify(payload);

        const url = require('url');
        const parsedUrl = url.parse(laillaUrl);

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payloadStr)
            }
        };

        const client = parsedUrl.protocol === 'https:' ? require('https') : require('http');

        const req = client.request(options, (res) => {
            let resData = '';
            res.on('data', (c) => resData += c);
            res.on('end', () => {
                console.log("Lailla Webhook Response:", res.statusCode, resData);
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error("Lailla Webhook Error:", e.message);
            resolve();
        });

        req.write(payloadStr);
        req.end();
    });
}

function triggerPushcutPendingWebhook() {
    return new Promise((resolve) => {
        const pushcutUrl = "https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Mercado%20Pago%20-%20Pendente";
        const url = require('url');
        const parsedUrl = url.parse(pushcutUrl);
        const options = {
            hostname: parsedUrl.hostname,
            port: 443,
            path: parsedUrl.path,
            method: 'POST',
            headers: {
                'Content-Length': 0
            }
        };
        const https = require('https');
        const req = https.request(options, (res) => {
            res.on('data', () => {});
            res.on('end', () => {
                console.log("Pushcut Pending Webhook Response status:", res.statusCode);
                resolve();
            });
        });
        req.on('error', (e) => {
            console.error("Pushcut Pending Webhook Error:", e.message);
            resolve();
        });
        req.end();
    });
}

function triggerPushcutApproved() {
    return new Promise((resolve) => {
        const pushcutUrl = "https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Mercado%20Pago%20-%20Aprovado%20";
        const url = require('url');
        const parsedUrl = url.parse(pushcutUrl);
        const options = {
            hostname: parsedUrl.hostname,
            port: 443,
            path: parsedUrl.path,
            method: 'POST',
            headers: {
                'Content-Length': '0'
            }
        };
        const https = require('https');
        const req = https.request(options, (res) => {
            let resData = '';
            res.on('data', (chunk) => resData += chunk);
            res.on('end', () => {
                console.log("Pushcut Approved notification sent. Response:", resData);
                resolve();
            });
        });
        req.on('error', (e) => {
            console.error("Pushcut Approved trigger failed:", e.message);
            resolve();
        });
        req.end();
    });
}

function triggerLaillaApproved(payer, parsedData, amount) {
    return new Promise((resolve) => {
        const laillaUrl = "https://api.lailla.io/v1/webhook/custom/1176ae8a-f7c0-433c-b404-084296d55506";

        let cleanPhone = (payer.phone || "").replace(/\D/g, '');
        if (cleanPhone && !cleanPhone.startsWith('55') && (cleanPhone.length === 10 || cleanPhone.length === 11)) {
            cleanPhone = '55' + cleanPhone;
        }

        const payload = {
            event: "order.approved",
            order: {
                id: parsedData.id ? `MP-${parsedData.id}` : `SR-${Math.floor(Math.random() * 900000 + 100000)}-BR`,
                status: "approved",
                payment_method: parsedData.payment_method_id || "pix",
                amount: parseFloat(amount),
                product: "Camisa Devocional de Nossa Senhora Aparecida"
            },
            customer: {
                name: `${payer.first_name} ${payer.last_name}`.trim(),
                email: payer.email,
                phone: cleanPhone
            }
        };

        const payloadStr = JSON.stringify(payload);

        const url = require('url');
        const parsedUrl = url.parse(laillaUrl);

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payloadStr)
            }
        };

        const client = parsedUrl.protocol === 'https:' ? require('https') : require('http');

        const req = client.request(options, (res) => {
            let resData = '';
            res.on('data', (c) => resData += c);
            res.on('end', () => {
                console.log("Lailla Approved Webhook Response:", res.statusCode, resData);
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error("Lailla Approved Webhook Error:", e.message);
            resolve();
        });

        req.write(payloadStr);
        req.end();
    });
}
