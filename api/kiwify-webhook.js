const https = require('https');

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        console.log("Kiwify Webhook Raw Body:", JSON.stringify(req.body));

        // 1. Check if this is a Kiwify Banking / Conta Digital Webhook
        if (req.body.type && req.body.type.startsWith('CASHIN.PIX.QRCODES')) {
            const eventType = req.body.type;
            const qrcodeData = req.body.data;
            const qrcodeId = qrcodeData?.id;
            
            console.log(`Kiwify Banking Webhook received. Event: ${eventType}, QR Code ID: ${qrcodeId}`);
            
            if (eventType === 'CASHIN.PIX.QRCODES.PAID' && qrcodeId) {
                const filepath = `/tmp/mock-payment-${qrcodeId}.json`;
                const fs = require('fs');
                if (fs.existsSync(filepath)) {
                    try {
                        const fileContent = fs.readFileSync(filepath, 'utf-8');
                        const { payer, transaction_amount } = JSON.parse(fileContent);
                        
                        await triggerPushcutApproved();
                        await triggerLaillaApproved({
                            first_name: payer.first_name || payer.name?.split(' ')[0] || "Devoto",
                            last_name: payer.last_name || payer.name?.split(' ').slice(1).join(' ') || "",
                            email: payer.email,
                            phone: payer.phone
                        }, {
                            id: qrcodeId,
                            payment_method_id: 'pix'
                        }, transaction_amount);
                        
                        fs.unlinkSync(filepath);
                        console.log(`Kiwify Banking Paid Webhook processed successfully for QR Code: ${qrcodeId}`);
                    } catch (err) {
                        console.error("Error processing banking paid webhook:", err.message);
                    }
                } else {
                    console.log(`Payer info not found or already processed for QR Code: ${qrcodeId}`);
                }
            }
            return res.status(200).send("OK");
        }

        // 2. Standard Platform / Product Sale Webhook
        const { order_id, order_status, payment_method, amount, Customer } = req.body;

        if (!order_id || !order_status) {
            console.log("Invalid Kiwify payload: missing order_id or order_status");
            return res.status(400).send("Invalid payload");
        }

        // We only process if the order status is approved
        if (order_status === 'approved') {
            const customerName = Customer?.full_name || `${Customer?.first_name || ""} ${Customer?.last_name || ""}`.trim() || "Devoto";
            const customerEmail = Customer?.email || "";
            let customerPhone = Customer?.mobile || "";

            // Normalize phone number
            customerPhone = customerPhone.replace(/\D/g, '');
            if (customerPhone && !customerPhone.startsWith('55') && (customerPhone.length === 10 || customerPhone.length === 11)) {
                customerPhone = '55' + customerPhone;
            }
            if (customerPhone && !customerPhone.startsWith('+')) {
                customerPhone = '+' + customerPhone;
            }

            const cleanAmount = parseFloat(amount || 0) / 100; // Kiwify sends amount in cents

            // 1. Trigger Pushcut Approved Notification
            try {
                await triggerPushcutApproved();
            } catch (pushcutErr) {
                console.error("Error launching Pushcut Approved Webhook from Kiwify:", pushcutErr.message);
            }

            // 2. Trigger Lailla Approved Webhook
            try {
                const payer = {
                    first_name: customerName.split(' ')[0],
                    last_name: customerName.split(' ').slice(1).join(' ') || 'Devoto',
                    email: customerEmail,
                    phone: customerPhone
                };
                const parsedData = {
                    id: order_id,
                    payment_method_id: payment_method || "pix"
                };
                await triggerLaillaApproved(payer, parsedData, cleanAmount);
            } catch (laillaErr) {
                console.error("Error launching Lailla Approved Webhook from Kiwify:", laillaErr.message);
            }

            // 3. Trigger Facebook CAPI Purchase
            try {
                const payer = {
                    first_name: customerName.split(' ')[0],
                    last_name: customerName.split(' ').slice(1).join(' ') || 'Devoto',
                    email: customerEmail,
                    phone: customerPhone
                };
                await triggerFacebookCAPI(payer, cleanAmount);
            } catch (capiErr) {
                console.error("Error launching Facebook CAPI from Kiwify:", capiErr.message);
            }

            console.log(`Kiwify Approved order ${order_id} processed successfully`);
        } else {
            console.log(`Skipping Kiwify status: ${order_status}`);
        }

        res.status(200).send("OK");

    } catch (error) {
        console.error("Kiwify Webhook processing error:", error.message);
        res.status(200).send("OK"); // Avoid retries
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
        const req = https.request(options, (res) => {
            let resData = '';
            res.on('data', (chunk) => resData += chunk);
            res.on('end', () => {
                console.log("Pushcut Approved notification sent from Kiwify webhook. Response:", resData);
                resolve();
            });
        });
        req.on('error', (e) => {
            console.error("Pushcut Approved trigger failed in Kiwify webhook:", e.message);
            resolve();
        });
        req.end();
    });
}

function triggerLaillaApproved(payer, parsedData, amount) {
    return new Promise((resolve) => {
        const laillaUrl = "https://api.lailla.io/v1/webhook/custom/16de6a1b-fc22-48ee-a6da-8517fd640d40";

        const payload = {
            event: "order.approved",
            phone: payer.phone,
            name: `${payer.first_name} ${payer.last_name}`.trim(),
            email: payer.email,
            order: {
                id: `KW-${parsedData.id}`,
                status: "approved",
                payment_method: parsedData.payment_method_id || "pix",
                amount: parseFloat(amount),
                product: "Camisa Devocional de Nossa Senhora Aparecida"
            },
            customer: {
                name: `${payer.first_name} ${payer.last_name}`.trim(),
                email: payer.email,
                phone: payer.phone
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
                console.log("Lailla Approved Webhook Response from Kiwify webhook:", res.statusCode, resData);
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error("Lailla Approved Webhook Error in Kiwify webhook:", e.message);
            resolve();
        });

        req.write(payloadStr);
        req.end();
    });
}

function triggerFacebookCAPI(payer, amount) {
    return new Promise((resolve) => {
        const crypto = require('crypto');
        const hash = (str) => {
            if (!str) return undefined;
            return crypto.createHash('sha256').update(str.trim().toLowerCase()).digest('hex');
        };

        const emailHash = hash(payer.email);
        const phoneHash = hash(payer.phone);
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

        // Send to Facebook API for pixel 1 (first pixel)
        const fbUrl1 = "https://graph.facebook.com/v17.0/1715424602283995/events?access_token=EAAM99ZAZCS6hIBO5yXk804Lw58fD5d7c3WJt7746193s6L1LIZB617vj38g84VvB6ZB182ZAZBs361tK45ZAQ19e86B2iZClZCa0ZBfZC00ZB6D94v5hZC108g48k0tZB48419ZCZAZC28929x66bV609ZC36y99hZB0ZCZBxqZCZC365287e0";
        // Send to Facebook API for pixel 2 (second pixel)
        const fbUrl2 = "https://graph.facebook.com/v17.0/1344595447110213/events?access_token=EAAK93ANGiaIBRZBHyeiZC77JH7ZCPZCf4s5ZCL8ZAtjpOKNSE8AXZCPH1Euwb0NpsxieVBFDZCuP4MmSWkpaUjWJ6vdWfZCzVZBzqjrZC0zZBkjzTYQdqirHN1JZBeDRZBUG0D6HG6Ki5oC8gqOCoLx3r3jEbZBcO4FXdlDVUR174q7b8TFt4k2cwOlf2wxIXZBCRrhoyrJyqQZDZD";

        const sendToFb = (fbUrl) => {
            return new Promise((resFb) => {
                const urlObj = require('url').parse(fbUrl);
                const options = {
                    hostname: urlObj.hostname,
                    port: 443,
                    path: urlObj.path,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(payloadStr)
                    }
                };
                const req = https.request(options, (res) => {
                    res.on('data', () => {});
                    res.on('end', () => resFb());
                });
                req.on('error', () => resFb());
                req.write(payloadStr);
                req.end();
            });
        };

        Promise.all([sendToFb(fbUrl1), sendToFb(fbUrl2)]).then(() => resolve());
    });
}
