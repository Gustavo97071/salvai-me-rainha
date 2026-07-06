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
        console.log("Mercado Pago Webhook Request Query:", req.query);
        console.log("Mercado Pago Webhook Request Body:", req.body);

        // Mercado Pago webhook payload format can be query parameters (for IPN) or JSON body
        let paymentId = req.query.id || (req.body && req.body.data && req.body.data.id) || (req.body && req.body.id);
        const topic = req.query.topic || (req.body && req.body.type) || 'payment';

        if (topic === 'payment' && paymentId) {
            const mpAccessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN || "APP_USR-6237078041440230-070300-0a8d02fca8b811f32ec1ddb51f27090e-136413525";
            
            const options = {
                hostname: 'api.mercadopago.com',
                port: 443,
                path: `/v1/payments/${paymentId}`,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${mpAccessToken}`
                }
            };

            await new Promise((resolve) => {
                const getReq = https.request(options, (getRes) => {
                    let data = '';
                    getRes.on('data', (chunk) => data += chunk);
                    getRes.on('end', async () => {
                        try {
                            const paymentData = JSON.parse(data);
                            console.log(`Payment Status for ID ${paymentId}:`, paymentData.status);
                            
                            if (paymentData.status === 'approved') {
                                // Trigger Pushcut Approved Notification
                                await triggerPushcutApproved();
                            }
                        } catch (err) {
                            console.error("Error parsing payment details:", err.message);
                        }
                        resolve();
                    });
                });

                getReq.on('error', (err) => {
                    console.error("Error querying payment details:", err.message);
                    resolve();
                });

                getReq.end();
            });
        }

        // Always respond with 200 OK or 201 Created to tell Mercado Pago the webhook was received
        res.status(200).send("OK");

    } catch (error) {
        console.error("Webhook processing error:", error.message);
        res.status(200).send("OK"); // Avoid retries
    }
};

function triggerPushcutApproved() {
    return new Promise((resolve) => {
        const pushcutUrl = "https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/MinhaNotifica%C3%A7%C3%A3o";
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
                console.log("Pushcut Approved notification sent from server. Response:", resData);
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error("Pushcut Approved trigger failed in backend:", e.message);
            resolve();
        });

        req.end();
    });
}
