const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Webhooks necesitan body RAW (va antes de express.json) ───────────────────
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let evento;
  try {
    evento = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook firma inválida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const datos = evento.data.object;

  switch (evento.type) {

    case 'checkout.session.completed':
      // Primera donación completada — suscripción creada
      console.log(`Nueva suscripción: ${datos.customer_email} | ${datos.currency?.toUpperCase()}`);
      // Aquí puedes: guardar en BD, enviar email de bienvenida, etc.
      break;

    case 'invoice.paid':
      // Cobro mensual exitoso (incluyendo el primero)
      const monto = (datos.amount_paid / 100).toFixed(2);
      const email = datos.customer_email;
      const periodo = new Date(datos.period_end * 1000).toLocaleDateString('es-MX');
      console.log(`Donación recibida: $${monto} MXN | ${email} | hasta ${periodo}`);
      // → Aquí registras en tu base de datos
      break;

    case 'invoice.payment_failed':
      // Cobro fallido — Stripe reintenta automáticamente (Smart Retries)
      console.log(`Cobro fallido: ${datos.customer_email} — Stripe reintentará`);
      break;

    case 'customer.subscription.deleted':
      // Donante canceló su suscripción
      console.log(`Suscripción cancelada: ${datos.customer}`);
      break;

    case 'customer.subscription.updated':
      // Donante cambió su monto desde el portal
      console.log(`Suscripción actualizada: ${datos.customer}`);
      break;
  }

  res.json({ recibido: true });
});

// ─── Middlewares generales ────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Crear sesión de Stripe Checkout con monto libre ─────────────────────────
app.post('/crear-sesion', async (req, res) => {
  const { monto_sugerido } = req.body; // en centavos MXN

  // Validación básica
  const monto = parseInt(monto_sugerido);
  if (!monto || monto < 5000) {
    return res.status(400).json({ error: 'El monto mínimo es $50 MXN' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      currency: 'mxn',
      locale: 'es',
      line_items: [{
        price_data: {
          currency: 'mxn',
          product_data: {
            name: 'Donación mensual · Plan 2040',
            description: 'Tu apoyo recurrente al Plan 2040. Puedes cancelar cuando quieras.',
            images: [], // Puedes agregar URL de imagen del logo
          },
          recurring: { interval: 'month' },
          custom_unit_amount: {
            enabled: true,
            minimum: 5000,           // $50 MXN mínimo
            maximum: 10000000,       // $100,000 MXN máximo
            preset: monto,           // monto que el usuario eligió
          },
        },
        quantity: 1,
      }],
      success_url: `${process.env.BASE_URL}/gracias?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/`,
      // Permite al donante ver y gestionar su suscripción después
      subscription_data: {
        metadata: {
          fuente: 'plan2040-web',
        },
      },
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error('Error creando sesión:', err.message);
    res.status(500).json({ error: 'No se pudo iniciar el pago. Intenta de nuevo.' });
  }
});

// ─── Página de agradecimiento (verificar sesión completada) ──────────────────
app.get('/gracias', async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.redirect('/');

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const monto = (session.amount_total / 100).toFixed(0);
    const email = session.customer_details?.email || '';

    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>¡Gracias! · Plan 2040</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: -apple-system, sans-serif; background: #f8f7ff; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
          .card { background: white; border-radius: 16px; padding: 48px 40px; max-width: 480px; width: 100%; text-align: center; border: 0.5px solid #e0dff8; }
          .icono { font-size: 48px; margin-bottom: 20px; }
          h1 { font-size: 26px; color: #26215C; margin-bottom: 12px; }
          p { color: #555; line-height: 1.6; margin-bottom: 8px; }
          .monto { font-size: 32px; font-weight: 600; color: #534AB7; margin: 20px 0; }
          .badge { display: inline-block; background: #EEEDFE; color: #534AB7; padding: 6px 16px; border-radius: 20px; font-size: 13px; margin-top: 8px; }
          a { display: block; margin-top: 28px; color: #534AB7; text-decoration: none; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icono">💜</div>
          <h1>¡Gracias por tu apoyo!</h1>
          <p>Tu donación mensual al Plan 2040 está activa.</p>
          <div class="monto">$${monto} MXN / mes</div>
          <p style="font-size:14px;color:#888;">${email}</p>
          <span class="badge">Suscripción activa</span>
          <a href="/">← Volver al inicio</a>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    res.redirect('/');
  }
});

// ─── Portal del cliente (permite cancelar o cambiar monto) ───────────────────
app.post('/portal-cliente', async (req, res) => {
  const { customer_id } = req.body;

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customer_id,
      return_url: `${process.env.BASE_URL}/`,
    });
    res.json({ url: portalSession.url });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo abrir el portal' });
  }
});

// ─── Health check para Render ─────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`Plan 2040 · Servidor corriendo en puerto ${PORT}`);
  console.log(`Modo: ${process.env.NODE_ENV || 'development'}`);
});
