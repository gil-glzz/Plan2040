const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Validación de configuración al arrancar
const FALTANTES = ['STRIPE_SECRET_KEY', 'BASE_URL'].filter(v => !process.env[v]);
if (FALTANTES.length) {
  console.warn(`⚠️  Faltan variables de entorno: ${FALTANTES.join(', ')}`);
}
if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.startsWith('sk_')) {
  console.warn('⚠️  STRIPE_SECRET_KEY no parece una clave secreta (debe empezar con sk_).');
}

// Límites de donación (en centavos MXN)
const MONTO_MINIMO = 5000;       // $50 MXN
const MONTO_MAXIMO = 10000000;   // $100,000 MXN

// ─── Webhook: necesita el body RAW, va antes de express.json() ────────────────
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.warn('Webhook recibido pero STRIPE_WEBHOOK_SECRET no está configurado.');
    return res.status(400).send('Webhook secret no configurado');
  }

  let evento;
  try {
    evento = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook firma inválida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const datos = evento.data.object;

  switch (evento.type) {
    case 'checkout.session.completed':
      console.log(`Nueva suscripción: ${datos.customer_email || datos.customer_details?.email || 's/email'}`);
      break;
    case 'invoice.paid': {
      const monto = (datos.amount_paid / 100).toFixed(2);
      const email = datos.customer_email || 's/email';
      console.log(`Donación recibida: $${monto} MXN | ${email}`);
      break;
    }
    case 'invoice.payment_failed':
      console.log(`Cobro fallido: ${datos.customer_email || datos.customer} — Stripe reintentará`);
      break;
    case 'customer.subscription.deleted':
      console.log(`Suscripción cancelada: ${datos.customer}`);
      break;
    case 'customer.subscription.updated':
      console.log(`Suscripción actualizada: ${datos.customer}`);
      break;
  }

  res.json({ recibido: true });
});

// ─── Middlewares generales ────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Crear sesión de Checkout (suscripción con monto libre) ───────────────────
//
// IMPORTANTE: custom_unit_amount NO funciona en mode:'subscription'.
// La forma correcta es crear price_data con un unit_amount fijo = el monto
// que el donante eligió. Esto crea un precio recurrente "al vuelo".
//
app.post('/crear-sesion', async (req, res) => {
  const monto = parseInt(req.body?.monto, 10);

  if (!Number.isFinite(monto) || monto < MONTO_MINIMO) {
    return res.status(400).json({ error: 'El monto mínimo es $50 MXN.' });
  }
  if (monto > MONTO_MAXIMO) {
    return res.status(400).json({ error: 'Para donaciones mayores a $100,000 MXN, contáctanos directamente.' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      locale: 'es',
      line_items: [{
        price_data: {
          currency: 'mxn',
          product_data: {
            name: 'Donación mensual · Plan 2040',
          },
          recurring: { interval: 'month' },
          unit_amount: monto, // el monto que el donante eligió, en centavos
        },
        quantity: 1,
      }],
      success_url: `${process.env.BASE_URL}/gracias?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/`,
      subscription_data: {
        metadata: { fuente: 'plan2040-web' },
      },
    });

    return res.json({ url: session.url });

  } catch (err) {
    console.error('Error creando sesión:', err.message);
    return res.status(500).json({ error: 'No se pudo iniciar el pago. Intenta de nuevo.' });
  }
});

// ─── Página de agradecimiento ─────────────────────────────────────────────────
app.get('/gracias', async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.redirect('/');

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const monto = (session.amount_total / 100).toLocaleString('es-MX');
    const email = session.customer_details?.email || '';

    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>¡Gracias! · Plan 2040</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #faf9ff; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: white; border-radius: 16px; padding: 48px 40px; max-width: 480px; width: 100%; text-align: center; border: 0.5px solid #e0dff8; }
    .icono { width: 64px; height: 64px; background: #EEEDFE; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; }
    h1 { font-size: 26px; color: #26215C; margin-bottom: 12px; }
    p { color: #555; line-height: 1.6; margin-bottom: 8px; }
    .monto { font-size: 32px; font-weight: 600; color: #534AB7; margin: 20px 0; }
    .badge { display: inline-block; background: #EEEDFE; color: #534AB7; padding: 6px 16px; border-radius: 20px; font-size: 13px; margin-top: 8px; }
    a { display: inline-block; margin-top: 28px; color: #534AB7; text-decoration: none; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icono">
      <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="#534AB7" stroke-width="2.5">
        <path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <h1>¡Gracias por tu apoyo!</h1>
    <p>Tu donación mensual al Plan 2040 está activa.</p>
    <div class="monto">$${monto} MXN / mes</div>
    <p style="font-size:14px;color:#888;">${email}</p>
    <span class="badge">Suscripción activa</span>
    <br><a href="/">← Volver al inicio</a>
  </div>
</body>
</html>`);
  } catch (err) {
    console.error('Error en /gracias:', err.message);
    res.redirect('/');
  }
});

// ─── Portal del cliente ───────────────────────────────────────────────────────
app.post('/portal-cliente', async (req, res) => {
  const { customer_id } = req.body || {};
  if (!customer_id) return res.status(400).json({ error: 'Falta customer_id' });

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customer_id,
      return_url: `${process.env.BASE_URL}/`,
    });
    res.json({ url: portalSession.url });
  } catch (err) {
    console.error('Error en portal:', err.message);
    res.status(500).json({ error: 'No se pudo abrir el portal' });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`Plan 2040 · Servidor corriendo en puerto ${PORT}`);
  console.log(`Modo: ${process.env.NODE_ENV || 'development'}`);
});
