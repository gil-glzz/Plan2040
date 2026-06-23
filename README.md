# Motor de donaciones recurrentes · Plan 2040

Donaciones mensuales con monto libre usando Stripe Checkout + Node.js, desplegado en Render.

---

## Despliegue paso a paso

### 1. Subir a GitHub

```bash
git init
git add .
git commit -m "Motor de donaciones Plan 2040"
git remote add origin https://github.com/TU_USUARIO/plan2040.git
git push -u origin main
```

### 2. Crear Web Service en Render

1. Entra a https://render.com → **New → Web Service**
2. Conecta tu repositorio de GitHub
3. Configura:
   - **Name:** `plan2040`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free (suficiente para empezar)

### 3. Variables de entorno en Render

En tu Web Service → **Environment → Add Environment Variable**:

| Variable | Valor |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_...` (de dashboard.stripe.com/apikeys) |
| `STRIPE_WEBHOOK_SECRET` | lo obtienes en el paso 4 |
| `BASE_URL` | `https://plan2040.onrender.com` |

### 4. Registrar el Webhook en Stripe

1. Ve a https://dashboard.stripe.com/webhooks
2. **Add endpoint**
3. URL: `https://plan2040.onrender.com/webhook`
4. Eventos a escuchar:
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
   - `customer.subscription.updated`
5. Copia el **Signing secret** (`whsec_...`) y agrégalo como `STRIPE_WEBHOOK_SECRET` en Render

### 5. Activar el Portal del Cliente en Stripe

Esto permite que los donantes cambien su monto o cancelen sin contactarte:

1. https://dashboard.stripe.com/settings/billing/portal
2. Actívalo y configura qué pueden hacer (cancelar, cambiar plan)

---

## Pruebas locales

```bash
npm install
cp .env.example .env
# Edita .env con tus claves de PRUEBA (sk_test_...)
node server.js
```

Para probar webhooks localmente instala Stripe CLI:
```bash
stripe listen --forward-to localhost:3000/webhook
```

Tarjetas de prueba:
- `4242 4242 4242 4242` — pago exitoso
- `4000 0000 0000 0341` — cobro fallido

---

## Notas para México

- Stripe México cobra **3.6% + $3 MXN** por transacción exitosa
- Necesitas RFC y cuenta bancaria mexicana vinculada en tu cuenta Stripe
- Los pagos se depositan en 2 días hábiles
- Plan gratuito de Render tiene "sleep" después de 15 min de inactividad;
  considera el plan Starter ($7 USD/mes) para producción
