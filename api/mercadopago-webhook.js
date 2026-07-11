const https = require('https');

// Global Set to keep track of processed approved payment IDs in the current instance container
const processedPayments = new Set();

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
            // Skip merchant_order topic to prevent double trigger (we rely exclusively on the direct payment topic)
            if (topic === 'merchant_order' || topic === 'merchant-order') {
                console.log(`Skipping merchant_order ${resourceId} to prevent duplicate triggers`);
                return res.status(200).send("OK");
            }

            const newToken = "APP_USR-8992204038760430-071022-0017efee923c2d2d7c482f2a4b0d4bde-3535669114";
            const oldToken = process.env.MERCADO_PAGO_ACCESS_TOKEN || "APP_USR-6237078041440230-070300-0a8d02fca8b811f32ec1ddb51f27090e-136413525";

            const fetchPayment = (resourceId, token) => {
                return new Promise((resolve) => {
                    const options = {
                        hostname: 'api.mercadopago.com',
                        port: 443,
                        path: `/v1/payments/${resourceId}`,
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    };

                    const getReq = https.request(options, (getRes) => {
                        let data = '';
                        getRes.on('data', (chunk) => data += chunk);
                        getRes.on('end', () => {
                            if (getRes.statusCode >= 200 && getRes.statusCode < 300) {
                                try {
                                    resolve(JSON.parse(data));
                                } catch (e) {
                                    resolve(null);
                                }
                            } else {
                                resolve(null);
                            }
                        });
                    });

                    getReq.on('error', () => {
                        resolve(null);
                    });

                    getReq.end();
                });
            };

            // Query payment API with new token first, fallback to old token
            console.log(`Querying payment ${resourceId} with new token...`);
            let paymentData = await fetchPayment(resourceId, newToken);
            if (!paymentData) {
                console.log("Querying payment " + resourceId + " with old token fallback...");
                paymentData = await fetchPayment(resourceId, oldToken);
            }

            if (paymentData) {
                console.log(`Payment Status for ID ${resourceId}:`, paymentData.status);
                
                if (paymentData.status === 'approved') {
                    // Double check if we've already triggered for this ID
                    if (processedPayments.has(resourceId)) {
                        console.log(`Payment ${resourceId} already processed as approved in this instance container. Skipping duplicate triggers.`);
                    } else {
                        processedPayments.add(resourceId);

                        // Trigger conversion webhooks in parallel (much faster, resolves timeout issues)
                        try {
                            await Promise.allSettled([
                                triggerPushcutApprovedByAmount(paymentData.transaction_amount),
                                triggerLaillaApproved(paymentData)
                            ]);
                        } catch (webhookErr) {
                            console.error("Error in webhook parallel triggers:", webhookErr.message);
                        }
                    }
                } else {
                    console.log(`Payment status is ${paymentData.status}, not approved. Skipping.`);
                }
            } else {
                console.error(`Failed to fetch payment details for ID ${resourceId} with both tokens.`);
            }
        } else {
            console.log("No resource ID found in webhook payload. Skipping check.");
        }

        res.status(200).send("OK");

    } catch (error) {
        console.error("Webhook processing error:", error.message);
        res.status(200).send("OK");
    }
};

function triggerPushcutApprovedByAmount(amount) {
    return new Promise((resolve) => {
        const roundedAmount = Math.round(amount);
        let pushcutUrl = "";
        
        if (roundedAmount === 10) {
            pushcutUrl = "https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Pago%20-%2010";
        } else if (roundedAmount === 15) {
            pushcutUrl = "https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Pago%20-%2015";
        } else if (roundedAmount === 20) {
            pushcutUrl = "https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Pago%20-%2020";
        } else if (roundedAmount === 50) {
            pushcutUrl = "https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Pago%20-%2050";
        } else {
            console.log(`Unknown amount ${roundedAmount} for Pushcut approved. Skipping.`);
            return resolve();
        }

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
                console.log(`Pushcut Approved notification (${roundedAmount}) sent. Response:`, resData);
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error(`Pushcut Approved notification (${roundedAmount}) trigger failed:`, e.message);
            resolve();
        });

        req.end();
    });
}

function triggerLaillaApproved(paymentData) {
    return new Promise((resolve) => {
        const laillaUrl = "https://api.lailla.io/v1/webhook/custom/e29eb85a-261b-472a-af04-19fa77e1b770";

        let cleanPhone = "";
        if (paymentData.payer && paymentData.payer.phone) {
            const areaCode = paymentData.payer.phone.area_code || "";
            const number = paymentData.payer.phone.number || "";
            cleanPhone = (areaCode + number).replace(/\D/g, '');
            if (cleanPhone && !cleanPhone.startsWith('55') && (cleanPhone.length === 10 || cleanPhone.length === 11)) {
                cleanPhone = '55' + cleanPhone;
            }
        }

        const payload = {
            event: "order.approved",
            order: {
                id: paymentData.id ? `MP-${paymentData.id}` : `SR-${Math.floor(Math.random() * 900000 + 100000)}-BR`,
                status: "approved",
                payment_method: paymentData.payment_method_id || "pix",
                amount: parseFloat(paymentData.transaction_amount || 0),
                product: "Camisa Devocional de Nossa Senhora Aparecida"
            },
            customer: {
                name: `${paymentData.payer?.first_name || ""} ${paymentData.payer?.last_name || ""}`.trim() || "Devoto",
                email: paymentData.payer?.email || "",
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
