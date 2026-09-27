import os, urllib.request, json, time, urllib.parse, datetime, sys

PUBLIC_KEY = os.environ.get('OMEGA_PUBLIC_KEY', 'startplataforma_hd2un77uamc15j81')
SECRET_KEY = os.environ.get('OMEGA_SECRET_KEY', '')
SB_KEY = os.environ.get('SUPABASE_ANON_KEY', '')
SB_URL = (os.environ.get('SUPABASE_URL', 'https://nubsgeuoepqqkhqbkuqz.supabase.co')).rstrip('/') + '/rest/v1/orders'

def log(msg):
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{now}] {msg}", flush=True)

def trigger_pushcut(amount):
    rounded = round(float(amount))
    pushcut_map = {
        10: 'https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Pago%20-%2010',
        15: 'https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Pago%20-%2015',
        20: 'https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Pago%20-%2020',
        50: 'https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Pago%20-%2050',
        60: 'https://api.pushcut.io/K1TZkL2GM2OjtKHRpac5Y/notifications/Pix%20Pago%20-%2050'
    }
    url = pushcut_map.get(rounded, pushcut_map[10])
    try:
        req = urllib.request.Request(
            url, 
            data=b'{}', 
            headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'}, 
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.status == 200
    except Exception as e:
        log(f"Pushcut error for R$ {amount}: {e}")
        return False

def check_omega_status(order_id, tracking_code):
    for attempt in range(2):
        try:
            req_om = urllib.request.Request(
                f'https://app.omegapayments.com.br/api/v1/gateway/transactions?clientIdentifier={urllib.parse.quote(order_id)}',
                headers={'x-public-key': PUBLIC_KEY, 'x-secret-key': SECRET_KEY, 'User-Agent': 'Mozilla/5.0'}
            )
            with urllib.request.urlopen(req_om, timeout=10) as resp:
                tx = json.loads(resp.read().decode('utf-8'))
                status = (tx.get('status') or '').upper()
                if status in ['COMPLETED', 'APPROVED', 'PAID']:
                    return status

            # If not found or pending, try by tracking_code
            if tracking_code:
                time.sleep(0.15)
                req_om2 = urllib.request.Request(
                    f'https://app.omegapayments.com.br/api/v1/gateway/transactions?id={urllib.parse.quote(tracking_code)}',
                    headers={'x-public-key': PUBLIC_KEY, 'x-secret-key': SECRET_KEY, 'User-Agent': 'Mozilla/5.0'}
                )
                with urllib.request.urlopen(req_om2, timeout=10) as resp2:
                    tx2 = json.loads(resp2.read().decode('utf-8'))
                    status2 = (tx2.get('status') or '').upper()
                    if status2 in ['COMPLETED', 'APPROVED', 'PAID']:
                        return status2

            return status or 'PENDING'
        except urllib.error.HTTPError as e:
            if e.code == 429:
                log("⚠️ Omega API Rate Limited. Pausando 30 segundos...")
                time.sleep(30)
                return 'PENDING'
            time.sleep(0.5)
        except Exception:
            time.sleep(0.5)
    return 'PENDING'

def run_single_scan():
    # 1. Fetch pending orders created in the last 2 hours (top 30 most recent)
    past_date = (datetime.datetime.utcnow() - datetime.timedelta(hours=2)).strftime('%Y-%m-%dT%H:%M:%SZ')
    req_sb = urllib.request.Request(
        f'{SB_URL}?payment_status=eq.pending&created_at=gte.{past_date}&order=created_at.desc&limit=30',
        headers={'apikey': SB_KEY, 'Authorization': f'Bearer {SB_KEY}'}
    )
    
    try:
        with urllib.request.urlopen(req_sb, timeout=15) as resp:
            pending_orders = json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        log(f"Erro ao buscar pedidos pendentes no Supabase: {e}")
        return 0, 0

    if not pending_orders:
        return 0, 0

    log(f"🔍 Varrendo {len(pending_orders)} pedidos pendentes recentes...")
    approved_count = 0
    pushcut_count = 0

    for o in pending_orders:
        oid = o.get('id')
        tx_code = o.get('tracking_code')
        amount = float(o.get('donation_amount') or 10.00)
        donor_name = o.get('donor_name') or 'Devoto'

        status = check_omega_status(oid, tx_code)

        if status in ['COMPLETED', 'APPROVED', 'PAID']:
            # Update Supabase
            req_update = urllib.request.Request(
                f'{SB_URL}?id=eq.{urllib.parse.quote(oid)}&payment_status=eq.pending',
                data=json.dumps({'payment_status': 'approved'}).encode('utf-8'),
                headers={
                    'apikey': SB_KEY, 
                    'Authorization': f'Bearer {SB_KEY}', 
                    'Content-Type': 'application/json', 
                    'Prefer': 'return=representation'
                },
                method='PATCH'
            )
            try:
                with urllib.request.urlopen(req_update, timeout=10) as res_update:
                    updated = json.loads(res_update.read().decode('utf-8'))
                    if updated:
                        approved_count += 1
                        ok = trigger_pushcut(amount)
                        if ok:
                            pushcut_count += 1
                        log(f"✅ NOVO PAGO CONFIRMADO: {oid} | {donor_name} | R$ {amount:.2f} | Pushcut: {'OK' if ok else 'FAIL'}")
            except Exception as err:
                log(f"Erro ao atualizar pedido {oid}: {err}")

        time.sleep(0.3)

    if approved_count > 0:
        log(f"🏁 Rodada finalizada: {approved_count} novos pagamentos aprovados!")
    return approved_count, pushcut_count

def main():
    log("==================================================================")
    log("🚀 SERVIÇO DE VARREDURA AUTOMÁTICA ULTRA LEVE (A CADA 1 MINUTO)")
    log("==================================================================")
    
    interval_seconds = 60
    
    while True:
        try:
            run_single_scan()
        except Exception as e:
            log(f"Erro inesperado na rodada: {e}")
        
        time.sleep(interval_seconds)

if __name__ == '__main__':
    main()
