const fs = require('fs');

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

        const isMock = id.toString().startsWith('98765');

        if (isMock) {
            const filepath = `/tmp/mock-payment-${id}.json`;
            if (fs.existsSync(filepath)) {
                try {
                    const fileContent = fs.readFileSync(filepath, 'utf-8');
                    const { payer, transaction_amount, payment_method_id } = JSON.parse(fileContent);

                    // Trigger Approved Webhooks
                    await triggerPushcutApproved();
                    await triggerLaillaApproved(payer, id, transaction_amount, payment_method_id);

                    // Delete the file to prevent double triggers on subsequent polling requests
                    fs.unlinkSync(filepath);
                } catch (webhookErr) {
                    console.error("Error triggering mock approved webhooks:", webhookErr.message);
                }
            }

            return res.status(200).json({ status: 'approved' });
        }

        // Fallback to real Mercado Pago check if it is not a mock ID (for legacy support)
        const mpAccessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
        if (!mpAccessToken) {
            return res.status(500).json({ error: 'Mercado Pago access token not configured' });
        }

        const https = require('https');
        const options = {
            hostname: 'api.mercadopago.com',
            port: 443,
            path: `/v1/payments/${id}`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${mpAccessToken}`
            }
        };

        const getReq = https.request(options, (getRes) => {
            let data = '';
            getRes.on('data', (chunk) => {
                data += chunk;
            });
            getRes.on('end', () => {
                try {
                    const parsedData = JSON.parse(data);
                    if (getRes.statusCode >= 200 && getRes.statusCode < 300) {
                        res.status(200).json({ status: parsedData.status });
                    } else {
                        res.status(getRes.statusCode).json(parsedData);
                    }
                } catch (e) {
                    res.status(500).json({ error: 'Failed to parse response from payment gateway', details: data });
                }
            });
        });

        getReq.on('error', (err) => {
            res.status(500).json({ error: 'Payment gateway connection error', details: err.message });
        });

        getReq.end();

    } catch (error) {
        res.status(500).json({ error: 'Internal server error', details: error.message });
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
