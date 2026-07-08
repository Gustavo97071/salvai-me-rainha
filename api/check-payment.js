const fs = require('fs');
const https = require('https');
const crypto = require('crypto');

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { id } = req.query;
        if (!id) {
            return res.status(400).json({ error: 'Missing payment ID' });
        }

        const KIWIFY_CLIENT_SECRET = process.env.KIWIFY_CLIENT_SECRET || 'ecf68e7dd6ecc2dce2632f276787403dc67a3c79a67ff8d1265d324ba4ffb0f4';
        const KIWIFY_CLIENT_ID = process.env.KIWIFY_CLIENT_ID || '7a3cf94c-83d8-4b8d-a721-91224f2b0781';

        // Check if we have payer info stored in /tmp
        const filepath = `/tmp/mock-payment-${id}.json`;
        let payerInfo = null;
        if (fs.existsSync(filepath)) {
            try {
                payerInfo = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
            } catch (err) {
                console.error("Error reading payer info file:", err.message);
            }
        }

        // Ed25519 PoP Signature generation
        const timestamp = Date.now().toString();
        const uri = `/v1/pix/qrcodes/${id}`;
        const method = 'GET';
        const body = '';
        const message = `${uri}:${method}:${body}:${timestamp}`;

        const seed = Buffer.from(KIWIFY_CLIENT_SECRET, 'hex');
        const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
        const pkcs8Buffer = Buffer.concat([pkcs8Prefix, seed]);

        const privateKey = crypto.createPrivateKey({
            key: pkcs8Buffer,
            format: 'der',
            type: 'pkcs8'
        });

        const signature = crypto.sign(null, Buffer.from(message), privateKey).toString('base64');

        // Call Kiwify Banking GET endpoint
        const kiwifyRes = await new Promise((resolve, reject) => {
            const options = {
                hostname: 'conta-public-api.kiwify.com',
                port: 443,
                path: uri,
                method: method,
                headers: {
                    'Accept': 'application/json',
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
            reqCall.end();
        });

        // status values: 'waiting_payment', 'paid', 'cancelled'
        if (kiwifyRes.status === 'paid') {
            // Trigger webhooks if we have the payer info and it was not triggered yet
            if (payerInfo) {
                try {
                    await triggerPushcutApproved();
                    await triggerLaillaApproved(payerInfo.payer, id, payerInfo.transaction_amount, 'pix');
                    
                    // Delete the file to prevent double triggers on subsequent polling requests
                    fs.unlinkSync(filepath);
                } catch (webhookErr) {
                    console.error("Error triggering approved webhooks:", webhookErr.message);
                }
            }
            return res.status(200).json({ status: 'approved' });
        } else if (kiwifyRes.status === 'cancelled') {
            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath);
            }
            return res.status(200).json({ status: 'cancelled' });
        } else {
            return res.status(200).json({ status: 'pending' });
        }

    } catch (error) {
        console.error("Payment check error:", error.message);
        // If Kiwify check fails (e.g. sandbox credentials, network error), fallback to mock behavior to ensure testability
        return res.status(200).json({ status: 'pending' });
    }
};

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
                console.log("Pushcut Approved notification sent from check-payment. Response:", resData);
                resolve();
            });
        });
        req.on('error', (e) => {
            console.error("Pushcut Approved trigger failed in check-payment:", e.message);
            resolve();
        });
        req.end();
    });
}

function triggerLaillaApproved(payer, id, amount, payment_method_id) {
    return new Promise((resolve) => {
        const laillaUrl = "https://api.lailla.io/v1/webhook/custom/1176ae8a-f7c0-433c-b404-084296d55506";

        let cleanPhone = (payer.phone || "").replace(/\D/g, '');
        if (cleanPhone && !cleanPhone.startsWith('55') && (cleanPhone.length === 10 || cleanPhone.length === 11)) {
            cleanPhone = '55' + cleanPhone;
        }

        const payload = {
            event: "order.approved",
            order: {
                id: `MP-${id}`,
                status: "approved",
                payment_method: payment_method_id || "pix",
                amount: parseFloat(amount),
                product: "Camisa Devocional de Nossa Senhora Aparecida"
            },
            customer: {
                name: `${payer.first_name || ""} ${payer.last_name || ""}`.trim() || "Devoto",
                email: payer.email || "",
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
                console.log("Lailla Approved Webhook Response from check-payment:", res.statusCode, resData);
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error("Lailla Approved Webhook Error in check-payment:", e.message);
            resolve();
        });

        req.write(payloadStr);
        req.end();
    });
}
