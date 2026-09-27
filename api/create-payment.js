const https = require('https');
const supabase = require('./supabase');

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

    const { transaction_amount, payer } = req.body || {};

    try {
        const idempotencyKey = req.headers['x-idempotency-key'] || Math.random().toString(36).substring(2, 15);
        const mpAccessToken = "APP_USR-8992204038760430-071022-0017efee923c2d2d7c482f2a4b0d4bde-3535669114";

        let areaCode = "";
        let phoneNumber = "";
        if (payer && payer.phone) {
            const digits = payer.phone.replace(/\D/g, '');
            let localDigits = digits;
            if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
                localDigits = digits.substring(2);
            }
            if (localDigits.length >= 10) {
                areaCode = localDigits.substring(0, 2);
                phoneNumber = localDigits.substring(2);
            } else {
                phoneNumber = localDigits;
            }
        }

        let cleanPhone = "";
        if (payer && payer.phone) {
            cleanPhone = payer.phone.replace(/\D/g, '');
            if (cleanPhone && !cleanPhone.startsWith('55') && (cleanPhone.length === 10 || cleanPhone.length === 11)) {
                cleanPhone = '55' + cleanPhone;
            }
            if (cleanPhone && !cleanPhone.startsWith('+')) {
                cleanPhone = '+' + cleanPhone;
            }
        }

        const clientIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || '';
        const cleanIp = clientIp.split(',')[0].trim();
        const userAgent = req.headers['user-agent'] || '';

        const cookies = req.headers.cookie || '';
        let fbp = '';
        let fbc = '';
        cookies.split(';').forEach(c => {
            const parts = c.trim().split('=');
            if (parts[0] === '_fbp') fbp = parts[1];
            if (parts[0] === '_fbc') fbc = parts[1];
        });

        const orderId = `SR-${Math.floor(100000 + Math.random() * 900000)}-BR`;

        console.log(`Starting Woovi integration for Order: ${orderId}...`);
        
        const wooviCharge = await createWooviPayment(transaction_amount, orderId, payer);
        console.log(`Woovi Charge created successfully! ID: ${wooviCharge.identifier || wooviCharge.correlationID}`);

        const identifier = wooviCharge.identifier || wooviCharge.correlationID || orderId;
        const pixCode = wooviCharge.brCode || "";
        const qrCodeImage = wooviCharge.qrCodeImage || (pixCode ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(pixCode)}` : "");

        const parsedData = {
            id: identifier,
            status: 'pending',
            point_of_interaction: {
                transaction_data: {
                    qr_code: pixCode,
                    qr_code_base64: qrCodeImage
                }
            }
        };

        const parsedAmount = parseFloat(transaction_amount || 60.00);

        const rawCpf = payer.identification?.number?.replace(/\D/g, '') || '';
        let formattedCpf = rawCpf;
        if (rawCpf.length === 11) {
            formattedCpf = rawCpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
        }

        const baseComplement = payer.address?.complement || "";
        const complementWithCpf = formattedCpf 
            ? (baseComplement ? `CPF: ${formattedCpf} | ${baseComplement}` : `CPF: ${formattedCpf}`)
            : baseComplement;

        // 4. Persist to Supabase & Trigger background services in parallel (awaited to prevent Vercel freezing)
        const dbOrder = {
            id: orderId,
            donor_name: `${payer.first_name || ""} ${payer.last_name || ""}`.trim() || "Devoto",
            donor_email: payer.email,
            donor_phone: cleanPhone,
            donation_amount: parsedAmount,
            shirt_size: payer.shirt_size || "M",
            address_cep: payer.address?.zip_code || "",
            address_street: payer.address?.street_name || "",
            address_number: payer.address?.street_number || "",
            address_complement: complementWithCpf,
            address_neighborhood: payer.address?.neighborhood || "",
            address_city: payer.address?.city || "",
            address_state: payer.address?.state || "",
            payment_status: 'pending',
            shipping_status: "pending",
            tracking_code: parsedData.id
        };
        if (formattedCpf) {
            dbOrder.donor_cpf = formattedCpf;
        }

        try {
            await Promise.allSettled([
                supabase.insertOrder(dbOrder),
                triggerFacebookCAPI(payer, parsedAmount, orderId, cleanIp, userAgent, fbp, fbc),
                triggerLaillaPending(payer, parsedData, parsedAmount),
                triggerPushcutPendingByAmount(parsedAmount),
                sendBrevoPendingEmail(payer, parsedData, parsedAmount),
                addContactToBrevoList(payer.email, `${payer.first_name || ""} ${payer.last_name || ""}`.trim() || "Devoto", cleanPhone, 8, parsedData.qr_code, parsedAmount)
            ]);
        } catch (triggerErr) {
            console.error("Error in creation triggers:", triggerErr.message);
        }

        parsedData.order_id = orderId;
        return res.status(200).json(parsedData);
    } catch (error) {
        console.error("Payment integration error:", error.message);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

function triggerFacebookCAPI(payer, amount, orderId, ip, ua, fbp, fbc) {
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
                event_id: orderId,
                event_source_url: "https://maesantissima.com/",
                action_source: "website",
                user_data: {
                    em: emailHash ? [emailHash] : undefined,
                    ph: phoneHash ? [phoneHash] : undefined,
                    fn: firstNameHash ? [firstNameHash] : undefined,
                    ln: lastNameHash ? [lastNameHash] : undefined,
                    client_ip_address: ip || undefined,
                    client_user_agent: ua || undefined,
                    fbp: fbp || undefined,
                    fbc: fbc || undefined
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

function triggerPushcutPendingByAmount(amount) {
    return new Promise((resolve) => {
        const roundedAmount = Math.round(parseFloat(amount || 50));
        let pushcutUrl = "";
        
        if (roundedAmount === 10) {
            pushcutUrl = "https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Gerado%20-%2010";
        } else if (roundedAmount === 15) {
            pushcutUrl = "https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Gerado%20-%2015";
        } else if (roundedAmount === 20) {
            pushcutUrl = "https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Gerado%20-%2020";
        } else if (roundedAmount === 50 || roundedAmount === 60) {
            pushcutUrl = "https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Gerado%20-%2050";
        } else {
            console.log(`Unknown amount ${roundedAmount} for Pushcut pending. Skipping.`);
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
            res.on('data', (c) => resData += c);
            res.on('end', () => {
                console.log(`Pushcut Pending Webhook (${roundedAmount}) Response status:`, res.statusCode);
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

function triggerPushcutApprovedByAmount(amount) {
    return new Promise((resolve) => {
        const roundedAmount = Math.round(parseFloat(amount || 50));
        let pushcutUrl = "";
        
        if (roundedAmount === 10) {
            pushcutUrl = "https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Pago%20-%2010";
        } else if (roundedAmount === 15) {
            pushcutUrl = "https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Pago%20-%2015";
        } else if (roundedAmount === 20) {
            pushcutUrl = "https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Pago%20-%2020";
        } else if (roundedAmount === 50 || roundedAmount === 60) {
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
            res.on('data', (c) => resData += c);
            res.on('end', () => {
                console.log(`Pushcut Approved Webhook (${roundedAmount}) Response status:`, res.statusCode);
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error("Pushcut Approved Webhook Error:", e.message);
            resolve();
        });

        req.end();
    });
}

function triggerLaillaPending(payer, parsedData, amount) {
    return new Promise((resolve) => {
        const laillaUrl = "https://api.lailla.io/v1/webhook/custom/3950364c-05c3-4081-94d4-d7e482920237";

        let cleanPhone = "";
        if (payer && payer.phone) {
            cleanPhone = payer.phone.replace(/\D/g, '');
            if (cleanPhone.startsWith('55') && (cleanPhone.length === 12 || cleanPhone.length === 13)) {
                // already has 55 country code
            } else if (cleanPhone.length === 10 || cleanPhone.length === 11) {
                cleanPhone = '55' + cleanPhone;
            } else if (cleanPhone.length === 12 || cleanPhone.length === 13) {
                // assume it has some other format but is close to digits
            }
        }

        const payload = {
            event: "order.pending",
            phone: cleanPhone,
            name: `${payer?.first_name || ""} ${payer?.last_name || ""}`.trim() || "Devoto",
            email: payer?.email || "",
            order: {
                id: parsedData.order_id || parsedData.id ? `SR-${parsedData.order_id || parsedData.id}` : `SR-${Date.now()}-BR`,
                status: "pending",
                payment_method: "pix",
                amount: parseFloat(amount || 0),
                product: "Camisa Devocional de Nossa Senhora Aparecida",
                pix_code: parsedData.point_of_interaction?.transaction_data?.qr_code || "",
                pix_qr_base64: parsedData.point_of_interaction?.transaction_data?.qr_code_base64 || ""
            },
            customer: {
                name: `${payer?.first_name || ""} ${payer?.last_name || ""}`.trim() || "Devoto",
                email: payer?.email || "",
                phone: cleanPhone
            }
        };

        const payloadStr = JSON.stringify(payload);

        const url = require('url');
        const parsedUrl = url.parse(laillaUrl);

        const options = {
            hostname: parsedUrl.hostname,
            port: 443,
            path: parsedUrl.path,
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
                console.log("Lailla Pending Webhook Response status:", res.statusCode);
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error("Lailla Pending Webhook Error:", e.message);
            resolve();
        });

        req.write(payloadStr);
        req.end();
    });
}

function sendBrevoPendingEmail(payer, parsedData, amount) {
    return new Promise((resolve) => {
        const apiKey = process.env.BREVO_API_KEY;
        const senderEmail = "contato@maesantissima.com";
        const recipientEmail = payer.email;
        const recipientName = `${payer.first_name || ""} ${payer.last_name || ""}`.trim() || "Devoto";
        const pixCode = parsedData.point_of_interaction?.transaction_data?.qr_code || "";
        const formattedAmount = parseFloat(amount).toFixed(2).replace('.', ',');

        const orderId = parsedData.metadata?.order_id || parsedData.external_reference || `SR-${Date.now()}-BR`;

        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Aguardando Pagamento do PIX</title>
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; background-color: #f1f5f9; color: #1e293b; margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
        .wrapper { width: 100%; table-layout: fixed; background-color: #f1f5f9; padding: 20px 0; }
        .main-card { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.1); border: 1px solid #cbd5e1; }
        .hero-header { background: linear-gradient(180deg, #021838 0%, #06234d 100%); color: #ffffff; padding: 32px 20px; text-align: center; }
        .brand-logo { font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: 0.5px; margin-bottom: 12px; }
        .crown-icon { font-size: 24px; display: inline-block; vertical-align: middle; }
        .brand-sub { font-size: 11px; color: #d4af37; font-weight: 600; letter-spacing: 0.5px; display: block; margin-top: 2px; }
        .hero-title { font-size: 20px; font-weight: 800; color: #ffffff; line-height: 1.4; margin: 16px 0 12px 0; }
        .highlight-gold { color: #facc15; font-weight: 900; }
        .hero-badge { display: inline-block; background: rgba(255, 255, 255, 0.15); border: 1px solid rgba(255, 255, 255, 0.3); padding: 6px 18px; border-radius: 50px; font-size: 12px; font-weight: 600; color: #ffffff; }
        .content-body { padding: 24px 20px; }
        .step-tracker-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; text-align: center; }
        .step-circle { width: 36px; height: 36px; border-radius: 50%; display: inline-block; line-height: 36px; font-size: 16px; color: #ffffff; font-weight: bold; }
        .step-completed { background-color: #002e5b; }
        .step-current { background-color: #f59e0b; box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.2); }
        .step-future { background-color: #e2e8f0; color: #94a3b8; }
        .step-text { font-size: 10.5px; font-weight: 700; color: #334155; margin-top: 4px; line-height: 1.2; }
        .pix-banner { background-color: #002347; color: #ffffff; border-radius: 12px 12px 0 0; padding: 14px; text-align: center; }
        .pix-banner-title { font-size: 16px; font-weight: 900; color: #facc15; margin: 0; }
        .pix-banner-sub { font-size: 12px; color: #cbd5e1; margin-top: 2px; }
        .pix-box { border: 2px solid #002347; border-top: none; border-radius: 0 0 14px 14px; padding: 20px 16px; background-color: #ffffff; text-align: center; margin-bottom: 24px; }
        .pix-code-field { background-color: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 8px; padding: 12px; font-family: monospace; font-size: 11px; color: #334155; word-break: break-all; margin-bottom: 14px; text-align: left; }
        .btn-copy { display: inline-block; background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-size: 14px; font-weight: 800; box-shadow: 0 4px 15px rgba(22, 163, 74, 0.3); }
        .timer-pill { display: inline-block; background-color: #fef3c7; border: 1px solid #fde047; padding: 6px 16px; border-radius: 50px; font-size: 12px; color: #78350f; font-weight: bold; margin-top: 16px; }
        .timer-pill strong { color: #dc2626; font-size: 14px; }
        .instructions-grid { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
        .instruction-card { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; text-align: center; }
        .trust-card { background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 14px; margin-bottom: 24px; font-size: 12px; color: #166534; }
        .summary-card { border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 24px; background-color: #ffffff; }
        .summary-title { font-size: 14px; font-weight: 800; color: #0f172a; margin-top: 0; margin-bottom: 12px; }
        .footer-banner { background-color: #002347; color: #ffffff; padding: 16px; text-align: center; border-radius: 12px; }
        .footer-banner span { color: #facc15; font-weight: 800; font-size: 13px; display: block; }
        .footer-banner small { color: #93c5fd; font-size: 11px; margin-top: 4px; display: block; }
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="main-card">
            
            <!-- HERO HEADER -->
            <div class="hero-header">
                <div class="brand-logo">
                    <span class="crown-icon">👑</span> Salvai-me Rainha
                    <span class="brand-sub">Projeto Nossa Senhora Aparecida</span>
                </div>
                <h1 class="hero-title">
                    Seu pedido foi confirmado!<br>
                    Falta apenas o pagamento do <span class="highlight-gold">PIX</span> para enviarmos sua camiseta.
                </h1>
                <div class="hero-badge">
                    🛡️ É rápido, seguro e leva apenas 2 minutos!
                </div>
            </div>

            <div class="content-body">

                <!-- STEP TRACKER -->
                <table class="step-tracker-table">
                    <tr>
                        <td width="25%">
                            <div class="step-circle step-completed">✓</div>
                            <div class="step-text">Pedido<br>realizado</div>
                        </td>
                        <td width="25%">
                            <div class="step-circle step-completed">✓</div>
                            <div class="step-text">Pedido<br>confirmado</div>
                        </td>
                        <td width="25%">
                            <div class="step-circle step-current">❖</div>
                            <div class="step-text" style="color: #b45309; font-weight: 800;">Aguardando<br>PIX</div>
                        </td>
                        <td width="25%">
                            <div class="step-circle step-future">🚚</div>
                            <div class="step-text" style="color: #94a3b8;">Em breve<br>enviamos</div>
                        </td>
                    </tr>
                </table>

                <!-- PIX PAY BOX -->
                <div class="pix-banner">
                    <div class="pix-banner-title">❖ PAGUE COM PIX</div>
                    <div class="pix-banner-sub">Copie a chave PIX abaixo para pagar no app do seu banco</div>
                </div>
                
                <div class="pix-box">
                    <div style="font-size: 12px; font-weight: 800; color: #334155; margin-bottom: 8px; text-align: left;">🔑 Código PIX Copia e Cola:</div>
                    <div class="pix-code-field">${pixCode}</div>
                    
                    <div style="margin-top: 16px; margin-bottom: 12px;">
                        <a href="https://maesantissima.com/copy-pix.html?code=${encodeURIComponent(pixCode)}" target="_blank" class="btn-copy">📋 CLIQUE AQUI PARA COPIAR O PIX</a>
                    </div>

                    <div class="timer-pill">
                        🕒 Prazo para pagamento: <strong>15:00 minutos</strong>
                    </div>
                </div>

                <!-- HOW TO PAY INSTRUCTIONS GRID -->
                <div style="font-size: 15px; font-weight: 800; color: #0f172a; text-align: center; margin-bottom: 12px;">💡 Como funciona?</div>
                <table class="instructions-grid">
                    <tr>
                        <td width="33%" style="padding: 4px;">
                            <div class="instruction-card">
                                <div style="font-size: 20px; margin-bottom: 4px;">📱</div>
                                <div style="font-size: 11px; font-weight: 800; color: #0f172a;">1. Copie o Código</div>
                                <div style="font-size: 10px; color: #64748b; margin-top: 2px;">Clique no botão acima.</div>
                            </div>
                        </td>
                        <td width="33%" style="padding: 4px;">
                            <div class="instruction-card">
                                <div style="font-size: 20px; margin-bottom: 4px;">🏦</div>
                                <div style="font-size: 11px; font-weight: 800; color: #0f172a;">2. Abra seu Banco</div>
                                <div style="font-size: 10px; color: #64748b; margin-top: 2px;">Escolha Pix Copia e Cola.</div>
                            </div>
                        </td>
                        <td width="33%" style="padding: 4px;">
                            <div class="instruction-card">
                                <div style="font-size: 20px; margin-bottom: 4px;">🛡️</div>
                                <div style="font-size: 11px; font-weight: 800; color: #0f172a;">3. Finalize</div>
                                <div style="font-size: 10px; color: #64748b; margin-top: 2px;">Seu presente será separado!</div>
                            </div>
                        </td>
                    </tr>
                </table>

                <!-- TRUST BANNER -->
                <div class="trust-card">
                    <table width="100%">
                        <tr>
                            <td width="40" valign="middle" style="font-size: 28px;">🛡️</td>
                            <td valign="middle">
                                <strong>Pagamento 100% Seguro</strong>
                                <div style="font-size: 10.5px; color: #15803d; margin-top: 2px;">Seus dados estão protegidos e seu presente será enviado imediatamente após a confirmação.</div>
                            </td>
                        </tr>
                    </table>
                </div>

                <!-- ORDER SUMMARY -->
                <div class="summary-card">
                    <h3 class="summary-title">🛍️ Resumo do seu pedido</h3>
                    <table width="100%">
                        <tr>
                            <td width="60" valign="top">
                                <img src="https://maesantissima.com/assets/camiseta_frente.jpg" width="54" height="54" style="border-radius: 8px; border: 1px solid #cbd5e1; object-fit: cover;" alt="Camiseta" />
                            </td>
                            <td valign="top" style="padding-left: 10px;">
                                <div style="font-size: 12px; font-weight: 800; color: #0f172a;">Camiseta Devocional Nossa Senhora Aparecida</div>
                                <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Quantidade: 1</div>
                                <div style="font-size: 11px; color: #64748b;">Código: <strong>${orderId}</strong></div>
                            </td>
                            <td valign="top" align="right" style="white-space: nowrap;">
                                <div style="font-size: 10px; color: #64748b;">Valor do pedido</div>
                                <div style="font-size: 16px; font-weight: 900; color: #002347; margin-top: 2px;">R$ ${formattedAmount}</div>
                            </td>
                        </tr>
                    </table>
                </div>

                <!-- DEVOTIONAL FOOTER BAR -->
                <div class="footer-banner">
                    <span>💛 Nossa Senhora Aparecida abençoe você e sua família!</span>
                    <small>Sua doação ajuda a manter este projeto de fé.</small>
                </div>

            </div>
        </div>
    </div>
</body>
</html>
        `;

        const payload = {
            sender: { name: "Mãe Santíssima", email: senderEmail },
            to: [{ email: recipientEmail, name: recipientName }],
            subject: "Falta pouco! Copie o seu código PIX para concluir sua doação",
            htmlContent: htmlContent
        };

        const payloadStr = JSON.stringify(payload);

        const options = {
            hostname: 'api.brevo.com',
            port: 443,
            path: '/v3/smtp/email',
            method: 'POST',
            headers: {
                'api-key': apiKey,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payloadStr)
            }
        };

        const req = https.request(options, (res) => {
            let resData = '';
            res.on('data', (c) => resData += c);
            res.on('end', () => {
                console.log("Brevo Pending Email Response status:", res.statusCode);
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error("Brevo Pending Email Error:", e.message);
            resolve();
        });

        req.write(payloadStr);
        req.end();
    });
}

function addContactToBrevoList(email, name, phone, listId, pixCode, amount) {
    return new Promise((resolve) => {
        const apiKey = process.env.BREVO_API_KEY;
        if (!apiKey) {
            console.error("Missing BREVO_API_KEY for adding contact to list");
            return resolve();
        }

        if (!email) {
            console.error("Missing email for adding contact to list");
            return resolve();
        }

        const nameParts = (name || "").trim().split(/\s+/);
        const firstName = nameParts[0] || "Devoto";
        const lastName = nameParts.slice(1).join(" ") || "";

        // Format phone: remove all non-digits, ensure country code 55 if Brazilian
        let cleanPhone = (phone || "").replace(/\D/g, '');
        if (cleanPhone && !cleanPhone.startsWith('55') && (cleanPhone.length === 10 || cleanPhone.length === 11)) {
            cleanPhone = '55' + cleanPhone;
        }

        const payload = {
            email: email,
            attributes: {
                NOME: firstName,
                SOBRENOME: lastName
            },
            listIds: [listId],
            updateEnabled: true
        };

        if (cleanPhone) {
            payload.attributes.SMS = cleanPhone;
        }

        if (pixCode) {
            payload.attributes.CODIGO_PIX = pixCode;
        }

        if (amount) {
            payload.attributes.VALOR = amount;
        }

        const payloadStr = JSON.stringify(payload);

        const options = {
            hostname: 'api.brevo.com',
            port: 443,
            path: '/v3/contacts',
            method: 'POST',
            headers: {
                'api-key': apiKey,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payloadStr)
            }
        };

        const req = https.request(options, (res) => {
            let resData = '';
            res.on('data', (c) => resData += c);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log(`Brevo Add Contact to list ${listId} status: ${res.statusCode}. Response: ${resData}`);
                    resolve();
                } else {
                    console.error(`Brevo Add Contact to list ${listId} failed with status: ${res.statusCode}. Response: ${resData}`);
                    if (payload.attributes && payload.attributes.SMS) {
                        console.log(`Retrying Brevo Add Contact to list ${listId} without SMS attribute...`);
                        const retryPayload = { ...payload };
                        retryPayload.attributes = { ...payload.attributes };
                        delete retryPayload.attributes.SMS;
                        
                        const retryPayloadStr = JSON.stringify(retryPayload);
                        const retryOptions = {
                            ...options,
                            headers: {
                                ...options.headers,
                                'Content-Length': Buffer.byteLength(retryPayloadStr)
                            }
                        };
                        const retryReq = https.request(retryOptions, (retryRes) => {
                            let retryResData = '';
                            retryRes.on('data', (c) => retryResData += c);
                            retryRes.on('end', () => {
                                console.log(`Brevo Retry Add Contact status: ${retryRes.statusCode}. Response: ${retryResData}`);
                                resolve();
                            });
                        });
                        retryReq.on('error', (re) => {
                            console.error(`Brevo Retry Add Contact error:`, re.message);
                            resolve();
                        });
                        retryReq.write(retryPayloadStr);
                        retryReq.end();
                    } else {
                        resolve();
                    }
                }
            });
        });

        req.on('error', (e) => {
            console.error(`Brevo Add Contact to list ${listId} error:`, e.message);
            resolve();
        });

        req.write(payloadStr);
        req.end();
    });
}

function generateValidCPF() {
    const rnd = n => Math.floor(Math.random() * n);
    const mod = (dividend, divisor) => Math.round(dividend - (Math.floor(dividend / divisor) * divisor));
    const n = Array.from({ length: 9 }, () => rnd(10));
    let d1 = n.reduce((total, number, index) => total + (number * (10 - index)), 0);
    d1 = 11 - mod(d1, 11);
    if (d1 >= 10) d1 = 0;
    let d2 = n.reduce((total, number, index) => total + (number * (11 - index)), 0) + (d1 * 2);
    d2 = 11 - mod(d2, 11);
    if (d2 >= 10) d2 = 0;
    return `${n.join('')}${d1}${d2}`;
}

function createWooviPayment(amount, orderId, payer) {
    return new Promise((resolve, reject) => {
        const appId = process.env.WOOVI_APP_ID || "Q2xpZW50X0lkXzU5MjAxZDg3LTU2ZWQtNGY3NC04NTFjLTgzZTM3NWVhNzhlZTpDbGllbnRfU2VjcmV0XzNiL0NjdDZXa04rWHhPeC9NYkxvNURXNTE2OE1tSndPYVo5MExkc1VjWXc9";

        let cleanPhone = (payer.phone || "").replace(/\D/g, '');
        if (cleanPhone && !cleanPhone.startsWith('55') && (cleanPhone.length === 10 || cleanPhone.length === 11)) {
            cleanPhone = '55' + cleanPhone;
        }
        if (cleanPhone && !cleanPhone.startsWith('+')) {
            cleanPhone = '+' + cleanPhone;
        }

        const valueCents = Math.round(parseFloat(amount || 60.00) * 100);
        const clientDoc = payer.identification?.number?.replace(/\D/g, '') || generateValidCPF();

        const payload = JSON.stringify({
            correlationID: orderId,
            value: valueCents,
            comment: `Doacao Camiseta N. Sra. Aparecida (${orderId})`,
            customer: {
                name: `${payer.first_name || ""} ${payer.last_name || ""}`.trim() || "Devoto",
                email: payer.email,
                phone: cleanPhone || "+5511999999999",
                taxID: clientDoc
            }
        });

        const req = https.request({
            hostname: 'api.openpix.com.br',
            port: 443,
            path: '/api/v1/charge',
            method: 'POST',
            headers: {
                'Authorization': appId,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (res.statusCode >= 200 && res.statusCode < 300 && parsed.charge) {
                        resolve(parsed.charge);
                    } else {
                        reject(new Error(`Failed to create Woovi charge: ${res.statusCode} - ${data}`));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}



function removeContactFromBrevoList(email, listId) {
    return new Promise((resolve) => {
        const apiKey = process.env.BREVO_API_KEY;
        if (!apiKey || !email) return resolve();

        const payload = {
            emails: [email]
        };
        const payloadStr = JSON.stringify(payload);

        const options = {
            hostname: 'api.brevo.com',
            port: 443,
            path: `/v3/contacts/lists/${listId}/contacts/remove`,
            method: 'POST',
            headers: {
                'api-key': apiKey,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payloadStr)
            }
        };

        const req = https.request(options, (res) => {
            let resData = '';
            res.on('data', (c) => resData += c);
            res.on('end', () => {
                console.log(`Brevo Remove Contact from list ${listId} status: ${res.statusCode}. Response: ${resData}`);
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error(`Brevo Remove Contact from list ${listId} error:`, e.message);
            resolve();
        });

        req.write(payloadStr);
        req.end();
    });
}

