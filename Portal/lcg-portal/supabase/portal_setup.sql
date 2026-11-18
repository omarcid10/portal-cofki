-- =====================================================================
-- Portal Cofki · Fase A (usuarios individuales)
-- Pégalo completo en Supabase > SQL Editor > New query > Run.
-- Es seguro correrlo más de una vez (no borra ni duplica datos).
-- Solo crea tablas con prefijo portal_ ; no toca tus otras tablas.
-- =====================================================================

-- 1) Sucursales (si ya tienes un catálogo de sucursales, avísame para enlazarlo)
create table if not exists public.portal_sucursales (
  codigo text primary key,
  nombre text not null,
  activa boolean not null default true,
  orden  int  not null default 0
);
insert into public.portal_sucursales (codigo, nombre, orden) values
  ('gm3',    'Gómez Morin (GM3)', 10),
  ('aurora', 'La Aurora',         20),
  ('serena', 'Pueblo Serena',     30)
on conflict (codigo) do nothing;

-- 2) Perfiles: un registro por persona con acceso al portal
create table if not exists public.portal_perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nombre text not null,
  rol text not null check (rol in ('socios','lideres','gerentes','supervisores','colaboradores','administrativos')),
  sucursales text[] not null default '{}',
  activo boolean not null default true,
  vinculado boolean not null default false, -- true = el usuario ya existía en Supabase (otra app)
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create unique index if not exists portal_perfiles_email_uq on public.portal_perfiles (lower(email));

-- 3) Catálogo de aplicaciones
create table if not exists public.portal_apps (
  id text primary key,
  nombre text not null,
  descripcion text not null default '',
  url text not null,
  modulo text,        -- se usará en la Fase B (módulos de Cofki OS)
  icono text,
  estado text not null default 'disponible' check (estado in ('disponible','en_desarrollo','proximamente','inactiva')),
  orden int not null default 0,
  roles_autorizados text[] not null default '{}',
  sucursales_autorizadas text[] not null default '{}', -- vacío = todas las sucursales
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- 4) Auditoría de cambios
create table if not exists public.portal_auditoria (
  id bigint generated always as identity primary key,
  fecha timestamptz not null default now(),
  actor text not null,
  accion text not null,
  objetivo text,
  detalle jsonb not null default '{}'::jsonb
);

-- 5) Buscar un usuario existente por correo (solo la llave service_role puede usarla)
create or replace function public.portal_buscar_usuario(p_email text)
returns uuid
language sql
security definer
set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;
revoke all on function public.portal_buscar_usuario(text) from public, anon, authenticated;
grant execute on function public.portal_buscar_usuario(text) to service_role;

-- 6) Seguridad (RLS). El portal escribe/lee con funciones del servidor (service_role).
--    Estas políticas protegen el acceso directo desde el navegador o desde otras apps.
alter table public.portal_sucursales enable row level security;
alter table public.portal_perfiles   enable row level security;
alter table public.portal_apps       enable row level security;
alter table public.portal_auditoria  enable row level security;

drop policy if exists portal_perfiles_propio on public.portal_perfiles;
create policy portal_perfiles_propio on public.portal_perfiles
  for select to authenticated using (id = auth.uid());

drop policy if exists portal_sucursales_lectura on public.portal_sucursales;
create policy portal_sucursales_lectura on public.portal_sucursales
  for select to authenticated
  using (exists (select 1 from public.portal_perfiles p where p.id = auth.uid() and p.activo));

drop policy if exists portal_apps_lectura on public.portal_apps;
create policy portal_apps_lectura on public.portal_apps
  for select to authenticated
  using (
    estado <> 'inactiva'
    and exists (
      select 1 from public.portal_perfiles p
      where p.id = auth.uid() and p.activo and p.rol = any (portal_apps.roles_autorizados)
    )
  );
-- portal_auditoria: sin políticas = solo service_role (el servidor) puede leerla o escribirla.

-- 7) Apps actuales del portal (mismos accesos que hoy; editables desde Administrar > Aplicaciones)
--    Equivalencia: Equipo -> colaboradores + supervisores. Administrativos: sin apps hasta que decidas.
insert into public.portal_apps (id, nombre, descripcion, url, estado, orden, roles_autorizados) values
  ('inventarios-diarios', 'Inventarios Diarios', 'Captura de inventario móvil conectada a Google Sheets', 'https://cerulean-sawine-627994.netlify.app/', 'disponible', 10, array['socios','lideres','gerentes','supervisores','colaboradores']::text[]),
  ('inventarios-semanales', 'Inventarios Semanales', 'Conteo de inventario total semanal, automatizado para carga en Parrot', 'https://cofki-inventarios-semanales.netlify.app/', 'disponible', 20, array['socios','lideres','gerentes','supervisores','colaboradores']::text[]),
  ('checklist-apertura-cierre', 'Checklist de Apertura y Cierre', 'Registro de apertura y cierre de sucursal', 'https://cofki-checklist.netlify.app/sucursal', 'disponible', 30, array['socios','lideres','gerentes','supervisores','colaboradores']::text[]),
  ('reservas', 'Administración de Reservas', 'Consulta y gestión de reservas de mesas', 'https://cofki-reservas-admin.netlify.app/', 'disponible', 40, array['socios','lideres','gerentes','supervisores','colaboradores']::text[]),
  ('llegadas-hostess-pueblo-serena', 'Llegadas Hostess - Pueblo Serena', 'Registro de llegadas y lista de espera en Pueblo Serena', 'https://hostess-llegadas-cofkiserena.netlify.app/', 'disponible', 50, array['socios','lideres','gerentes','supervisores','colaboradores']::text[]),
  ('entrevistas', 'Entrevistas', 'Gestión de entrevistas de contratación', 'https://entrevistascofki.netlify.app/', 'disponible', 60, array['socios','lideres','gerentes']::text[]),
  ('auditorias-operativas', 'Auditorías Operativas', 'Checklist de supervisión operativa por sucursal', 'https://checklist-supervision-socio.netlify.app/', 'disponible', 70, array['socios']::text[]),
  ('auditorias-semanales', 'Auditorías Semanales', 'Auditorías semanales de líderes A&B y Front, con planes de acción y dashboard', 'https://cofki-auditorias.netlify.app/', 'disponible', 80, array['socios','lideres','gerentes']::text[]),
  ('cuentas-por-pagar', 'Cuentas por Pagar', 'Control y seguimiento de cuentas por pagar', 'https://cofki-cuentas-por-pagar.netlify.app/', 'disponible', 90, array['socios','lideres']::text[]),
  ('registro-facturas-proveedores', 'Registro Facturas Proveedores', 'Registro operativo de facturas de proveedores', 'https://registro-facturas-cofki.netlify.app/', 'disponible', 100, array['gerentes','supervisores','colaboradores']::text[]),
  ('estandarizacion-recetas', 'Estandarización de Recetas', 'Biblioteca y gestión de recetas estandarizadas', 'https://cofki-recetas.netlify.app/', 'disponible', 110, array['socios','lideres']::text[]),
  ('dashboards-comerciales-financieros', 'Dashboards Comerciales y Financieros', 'Indicadores comerciales y financieros de Cofki', 'https://cofki-dashboards.netlify.app/', 'disponible', 120, array['socios']::text[]),
  ('solicitudes-compras', 'Solicitudes de Compras', 'Solicitudes de artículos de las sucursales, autorización y seguimiento', 'https://cofki-compras.netlify.app/sucursal', 'disponible', 130, array['socios','lideres','gerentes']::text[]),
  ('christmas-tracker', 'Cofki Christmas Tracker', 'Registro diario de la campaña navideña: foto de Santa, sellos, regalos y cartas', 'https://cofki-christmas-tracker.netlify.app/', 'disponible', 140, array['socios','lideres','gerentes','supervisores','colaboradores']::text[])
on conflict (id) do nothing;
