# Portal Cofki — usuarios individuales (Fase A)

Portal centralizado para las apps internas de Cofki Café. Cada persona entra con **su correo y su contraseña** (Supabase Auth) y ve solo las apps que le corresponden por **rol** y **sucursal**.

Roles: **Socios, Líderes, Gerentes, Supervisores, Colaboradores y Administrativos.** No hay jerarquía automática: cada app lista exactamente qué roles la ven.

Un socio administra todo desde `/admin.html`: usuarios (crear, editar rol y sucursales, desactivar, restablecer contraseña, eliminar), catálogo de aplicaciones (agregar, editar, activar/desactivar, asignar roles y sucursales) y auditoría de cambios. Sin tocar código.

## Cómo funciona

- Los usuarios viven en **Supabase Auth**; el portal agrega las tablas `portal_perfiles`, `portal_apps`, `portal_sucursales` y `portal_auditoria` (script: `supabase/portal_setup.sql`).
- El login lo valida una función de Netlify contra Supabase y entrega una cookie firmada (HttpOnly) que solo trae el id del usuario. En **cada** petición se consulta Supabase: si un socio desactiva o elimina a alguien, pierde el acceso al instante.
- La llave `SUPABASE_SERVICE_ROLE_KEY` vive solo en las variables de Netlify (nunca en el navegador ni en GitHub).
- El catálogo de apps se filtra en el servidor por rol y sucursal. Además hay políticas RLS en Supabase para el acceso directo.
- **Límite importante:** el portal controla quién *ve* cada app. Cada app es un sitio independiente: quien tenga su link directo todavía puede abrirla. Protegerlas de verdad requiere inicio de sesión compartido (fase futura).

## Variables de entorno (Netlify → Site configuration → Environment variables)

| Variable | Valor |
|---|---|
| `SESSION_SECRET` | La que ya tienes (obligatoria) |
| `SUPABASE_URL` | URL del proyecto, ej. `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Llave **service_role** (secreta) de Supabase → Project Settings → API |
| `SUPABASE_ANON_KEY` | Opcional, llave **anon** (pública) del mismo lugar |
| `LEGACY_LOGIN` | Pon `off` cuando todos tengan usuario, para apagar el acceso por contraseña de nivel |
| `BLOBS_SITE_ID`, `BLOBS_TOKEN` | Las que ya tienes (solo para el acceso temporal por nivel) |

## Puesta en marcha

1. Supabase → SQL Editor → pega y ejecuta `supabase/portal_setup.sql` (se puede correr más de una vez).
2. Agrega las variables de arriba en Netlify y vuelve a desplegar.
3. Entra con la contraseña de socios (acceso temporal), ve a **Administrar → Usuarios** y crea tu usuario (rol Socios) y el de tu socio.
4. Cierra sesión y entra con tu correo. Crea al resto del equipo.
5. Cuando todos tengan usuario, agrega `LEGACY_LOGIN=off` en Netlify. Las contraseñas por nivel dejan de funcionar.

## Si alguien sale del equipo

`/admin.html` → Usuarios → **Desactivar** (reversible) o **Eliminar**. Pierde el acceso de inmediato y nadie más se ve afectado. Si el usuario es compartido con otra app de Supabase, “Eliminar” solo le quita el acceso al portal.

## Agregar una app

`/admin.html` → Aplicaciones → **Nueva aplicación**: nombre, URL, estado, roles y sucursales. Aparece al instante.

> `netlify/functions/lib/apps.js` ya no es el catálogo oficial: solo alimenta el acceso temporal por nivel mientras exista.

## Diseño

Usa la identidad oficial de Cofki (Candy, Jungle, Honey, Butter; Montserrat / Montserrat Alternates). El logo vive en `public/assets/`.
