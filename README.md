# Zuvo

**Visualiza y elige tu tranquilidad financiera.**

Comparador de productos bancarios + seguimiento de cartera, con **cuentas de usuario**, **base de datos** y **precios en vivo**.

## Qué incluye
- **Registro e inicio de sesión.** Cada usuario tiene su cartera guardada en el servidor.
- **Cartera** con valor, rentabilidad, distribución y gráficos; añadir/editar/eliminar posiciones; exportar/importar.
- **Precios en vivo** vía Twelve Data (se actualizan solos cada 60 s). Sin clave, funciona en modo demo.
- **Comparador** de cuentas, tarjetas, hipotecas y préstamos (datos de ejemplo).
- **Textos legales** base en `/public/legal.html` (pendientes de revisión por un abogado).

## Requisitos
- Node.js 18 o superior.

## Puesta en marcha (local)
1. Instala dependencias:
   ```
   npm install
   ```
2. Copia la configuración y edítala:
   ```
   cp .env.example .env
   ```
   - `JWT_SECRET`: pon una cadena larga y aleatoria (obligatorio en producción).
   - `TWELVE_DATA_API_KEY`: opcional; consíguela gratis en https://twelvedata.com para precios en vivo.
3. Arranca:
   ```
   npm run local
   ```
4. Abre http://localhost:3000 y crea una cuenta.

## Cómo funciona
- **Frontend** (`public/`): la app. Si has iniciado sesión, la cartera se guarda en tu cuenta; si no, se guarda solo en el navegador (demo).
- **Backend** (`server.js`): registro/login con contraseña cifrada (bcrypt) y sesión por cookie (JWT); guarda la cartera de cada usuario; y hace de proxy de precios a Twelve Data con caché.
- **Base de datos**: archivo `data/db.json` (se crea solo al registrar el primer usuario).

### Endpoints principales
- `POST /api/register`, `POST /api/login`, `POST /api/logout`, `GET /api/me`
- `GET /api/portfolio`, `PUT /api/portfolio` (requieren sesión)
- `GET /api/prices?symbols=AAPL,MSFT`

## Despliegue
Sube el proyecto a un servicio Node (Railway, Render, Fly.io…):
1. Comando de arranque: `npm start`.
2. Variables de entorno en el panel: `JWT_SECRET`, `TWELVE_DATA_API_KEY`, `NODE_ENV=production`.
3. Nota sobre la base de datos: `data/db.json` sirve para arrancar y para pocos usuarios. **Para producción real, migra a PostgreSQL** (p. ej. Supabase o Neon), porque el archivo JSON no escala ni sobrevive bien a reinicios en algunos hostings.

## Lo que todavía depende de ti (no es código)
- Tu **clave de Twelve Data** para precios reales.
- **Rellenar el comparador con bancos reales**: curación manual desde fuentes oficiales (Banco de España, webs de cada entidad).
- **Revisión legal** de `legal.html` y cumplimiento RGPD por un profesional.
- **Despliegue** con tus cuentas y dominio.
- La **compraventa real** de acciones requiere integrar un socio regulado (p. ej. Upvest/lemon.markets) y resolver tu encaje regulatorio con la CNMV.

## Aviso
Herramienta informativa, no asesoramiento financiero. Los datos de productos bancarios son de ejemplo y deben verificarse en fuentes oficiales.
