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
        console.log("Mercado Pago Webhook Raw Query:", req.query);
        console.log("Mercado Pago Webhook Raw Body Type:", typeof req.body);
        console.log("Mercado Pago Webhook Raw Body:", req.body);

        let body = req.body;
        if (body && (typeof body === 'string' || Buffer.isBuffer(body))) {
            const bodyStr = body.toString();
            try {
                body = JSON.parse(bodyStr);
            } catch (e) {
                const querystring = require('querystring');
                body = querystring.parse(bodyStr);
            }
        }

        // Try extracting ID and Topic/Type from all possible locations
        let resourceId = req.query.id || 
                         req.query['data.id'] || 
                         (req.query.data && req.query.data.id) ||
                         req.query['data[id]'] ||
                         (body && body.data && body.data.id) || 
                         (body && body.id) ||
                         (body && body['data.id']) ||
                         (body && body['data[id]']);

        let topic = req.query.topic || 
                    req.query.type || 
                    req.query['type'] || 
                    (body && body.type) || 
                    (body && body.topic) ||
                    'payment';

        console.log("Extracted Resource ID:", resourceId);
        console.log("Extracted Topic/Type:", topic);

        if (resourceId) {
            const mpAccessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN || "APP_USR-6237078041440230-070300-0a8d02fca8b811f32ec1ddb51f27090e-136413525";
            
            // Skip merchant_order topic to prevent double trigger (we rely exclusively on the direct payment topic)
            if (topic === 'merchant_order' || topic === 'merchant-order') {
                console.log(`Skipping merchant_order ${resourceId} to prevent duplicate triggers`);
                return res.status(200).send("OK");
            }

            // Query payment API
            const options = {
                hostname: 'api.mercadopago.com',
                port: 443,
                path: `/v1/payments/${resourceId}`,
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
                            console.log(`Payment Status for ID ${resourceId}:`, paymentData.status);
                            
                            if (paymentData.status === 'approved') {
                                await triggerPushcutApproved();
                            } else {
                                console.log(`Payment status is ${paymentData.status}, not approved. Skipping.`);
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
        } else {
            console.log("No resource ID found in webhook payload. Skipping check.");
        }

        res.status(200).send("OK");

    } catch (error) {
        console.error("Webhook processing error:", error.message);
        res.status(200).send("OK");
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
