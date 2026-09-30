-- Cofki Auditorías · Instalación completa (archivos 01 a 07 en un solo script)

-- =====================================================================
-- Cofki Auditorías · 01 · Esquema (tipos y tablas)
-- Ejecutar en: Supabase → SQL Editor. Orden: 01 → 07.
-- =====================================================================

-- ---------- Tipos ----------
create type public.audit_status    as enum ('en_curso','cerrada','cancelada');
create type public.response_result as enum ('cumple','parcial','no_cumple','na');
create type public.priority_level  as enum ('critica','alta','media','baja');
create type public.item_type       as enum ('evaluable','medicion','dato');
create type public.action_status   as enum ('pendiente','en_proceso','corregido','no_corregido');
create type public.template_status as enum ('borrador','publicada','retirada');

-- ---------- Utilidad: updated_at automático ----------
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = public as $$ begin new.updated_at := now(); return new; end $$;

-- ---------- Catálogos generales ----------
create table public.roles (
  code text primary key,                 -- lider_ab | lider_front | socio
  name text not null
);

create table public.branches (
  id     serial primary key,
  code   text not null unique,
  name   text not null,
  active boolean not null default true,
  sort   int not null default 0
);

create table public.audit_types (
  id                 serial primary key,
  code               text not null unique,  -- AB | FRONT
  name               text not null,
  target_min_minutes int  not null default 180,
  target_max_minutes int  not null default 240,
  active             boolean not null default true,
  sort               int not null default 0
);

create table public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null,
  email         text,
  role_code     text not null references public.roles(code),
  audit_type_id int  references public.audit_types(id),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint users_tipo_por_rol check (
    (role_code = 'socio' and audit_type_id is null) or
    (role_code <> 'socio' and audit_type_id is not null)
  )
);

create table public.scoring_config (
  key         text primary key,
  value       numeric not null,
  description text
);

-- ---------- Plantillas versionadas ----------
create table public.template_versions (
  id            serial primary key,
  audit_type_id int not null references public.audit_types(id),
  version       int not null,
  status        public.template_status not null default 'borrador',
  notes         text,
  created_at    timestamptz not null default now(),
  published_at  timestamptz,
  unique (audit_type_id, version)
);
-- Solo una versión publicada por tipo
create unique index template_una_publicada
  on public.template_versions(audit_type_id) where status = 'publicada';

create table public.audit_sections (          -- Proceso (los 15 grandes)
  id                  serial primary key,
  template_version_id int not null references public.template_versions(id) on delete cascade,
  code                text,
  name                text not null,
  sort                int not null default 0,
  weight              numeric(6,2) not null default 1 check (weight >= 0)
);

create table public.audit_subsections (       -- Subproceso
  id         serial primary key,
  section_id int not null references public.audit_sections(id) on delete cascade,
  name       text not null,
  sort       int not null default 0,
  is_default boolean not null default false   -- "General" oculto cuando el proceso no tiene subgrupos
);

create table public.audit_items (             -- Punto auditable
  id            serial primary key,
  subsection_id int not null references public.audit_subsections(id) on delete cascade,
  code          text not null,                -- AB-001, FR-001
  text          text not null,
  original_text text,
  guidance      text,
  sort          int not null default 0,
  item_type     public.item_type not null default 'evaluable',
  weight        numeric(6,2) not null default 1 check (weight >= 0),
  unit          text,
  allow_na      boolean not null default true
);

-- ---------- Auditorías ----------
create table public.audits (
  id                  uuid primary key default gen_random_uuid(),
  template_version_id int  not null references public.template_versions(id),
  audit_type_id       int  not null references public.audit_types(id),
  branch_id           int  not null references public.branches(id),
  leader_id           uuid not null references public.users(id),
  week_start          date not null,              -- lunes de la semana (hora Monterrey)
  audit_date          date not null,
  status              public.audit_status not null default 'en_curso',
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  elapsed_seconds     int,
  active_seconds      int not null default 0,
  last_heartbeat_at   timestamptz,
  closed_under_target boolean,
  general_comments    text,
  strengths           text,
  opportunities       text,
  score_total         numeric(5,2),
  snapshot            jsonb,
  cancelled_at        timestamptz,
  cancelled_by        uuid references public.users(id),
  cancel_reason       text,
  reopened_count      int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
-- Evita duplicados: 1 auditoría por sucursal + tipo + semana (sin contar canceladas)
create unique index audits_sin_duplicados
  on public.audits(branch_id, audit_type_id, week_start) where status <> 'cancelada';
create index audits_semana on public.audits(week_start);
create index audits_lider  on public.audits(leader_id);
create trigger audits_updated before update on public.audits
  for each row execute function public.set_updated_at();

create table public.audit_responses (
  id                uuid primary key default gen_random_uuid(),
  audit_id          uuid not null references public.audits(id) on delete cascade,
  item_id           int  not null references public.audit_items(id),
  result            public.response_result,
  priority          public.priority_level,
  comment           text,
  measurement_value numeric,
  text_value        text,
  answered_at       timestamptz not null default now(),
  answered_by       uuid default auth.uid(),
  updated_at        timestamptz not null default now(),
  unique (audit_id, item_id)
);
create trigger responses_updated before update on public.audit_responses
  for each row execute function public.set_updated_at();

create table public.action_plans (
  id                uuid primary key default gen_random_uuid(),
  audit_id          uuid not null references public.audits(id) on delete cascade,
  response_id       uuid references public.audit_responses(id) on delete set null,
  item_id           int  references public.audit_items(id),
  section_id        int  references public.audit_sections(id),
  branch_id         int  references public.branches(id),
  audit_type_id     int  references public.audit_types(id),
  finding           text not null,
  corrective_action text not null,
  responsible       text not null,
  priority          public.priority_level not null,
  due_date          date not null,
  status            public.action_status not null default 'pendiente',
  created_by        uuid references public.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  closed_at         timestamptz,
  closed_by         uuid references public.users(id)
);
create index plans_estatus on public.action_plans(status, due_date);
create index plans_sucursal on public.action_plans(branch_id);
create trigger plans_updated before update on public.action_plans
  for each row execute function public.set_updated_at();

create table public.action_plan_updates (
  id             uuid primary key default gen_random_uuid(),
  action_plan_id uuid not null references public.action_plans(id) on delete cascade,
  from_status    public.action_status,
  to_status      public.action_status not null,
  comment        text,
  created_by     uuid references public.users(id),
  created_at     timestamptz not null default now()
);

create table public.audit_evidence (
  id             uuid primary key default gen_random_uuid(),
  audit_id       uuid not null references public.audits(id) on delete cascade,
  response_id    uuid references public.audit_responses(id) on delete set null,
  action_plan_id uuid references public.action_plans(id) on delete set null,
  item_id        int  not null references public.audit_items(id),
  section_id     int  references public.audit_sections(id),
  branch_id      int  references public.branches(id),
  leader_id      uuid references public.users(id),
  storage_path   text not null unique,
  thumb_path     text,
  caption        text,
  taken_at       timestamptz,
  created_by     uuid references public.users(id),
  created_at     timestamptz not null default now()
);
create index evidence_auditoria on public.audit_evidence(audit_id);

create table public.audit_scores (             -- Calificaciones congeladas al cerrar
  id       bigserial primary key,
  audit_id uuid not null references public.audits(id) on delete cascade,
  level    text not null check (level in ('punto','subproceso','proceso','total')),
  ref_id   int,
  earned   numeric,
  possible numeric,
  pct      numeric(5,2)
);
create index scores_auditoria on public.audit_scores(audit_id, level);

create table public.audit_change_log (         -- Registro de cancelaciones, reaperturas y cambios post-cierre
  id          bigserial primary key,
  audit_id    uuid references public.audits(id) on delete cascade,
  table_name  text not null,
  record_id   text,
  action      text not null,
  old_data    jsonb,
  new_data    jsonb,
  reason      text,
  changed_by  uuid default auth.uid(),
  changed_at  timestamptz not null default now()
);

-- =====================================================================
-- Cofki Auditorías · 02 · Funciones, reglas de negocio y candados
-- =====================================================================

-- ---------- Fechas (hora de Monterrey, semana lunes–domingo) ----------
create or replace function public.hoy() returns date
language sql stable set search_path = public as $$ select (now() at time zone 'America/Monterrey')::date $$;

create or replace function public.inicio_semana(p_ts timestamptz default now()) returns date
language sql stable set search_path = public as $$ select date_trunc('week', p_ts at time zone 'America/Monterrey')::date $$;

-- ---------- Usuario actual ----------
create or replace function public.mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select role_code from users where id = auth.uid() and active
$$;

create or replace function public.mi_tipo_auditoria() returns int
language sql stable security definer set search_path = public as $$
  select audit_type_id from users where id = auth.uid() and active
$$;

create or replace function public.es_socio() returns boolean
language sql stable set search_path = public as $$ select coalesce(public.mi_rol() = 'socio', false) $$;

create or replace function public.es_usuario_activo() returns boolean
language sql stable set search_path = public as $$ select public.mi_rol() is not null $$;

create or replace function public.config(p_key text, p_default numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select value from scoring_config where key = p_key), p_default)
$$;

-- ---------- Reglas simples ----------
-- Un plan sigue abierto (visible y cuenta para vencidos) salvo que esté "corregido".
create or replace function public.plan_abierto(p public.action_status) returns boolean
language sql immutable set search_path = public as $$ select p in ('pendiente','en_proceso','no_corregido') $$;

-- ¿El punto ya tiene respuesta suficiente?
create or replace function public.respuesta_completa(
  p_tipo public.item_type, p_result public.response_result, p_texto text, p_valor numeric)
returns boolean language sql immutable set search_path = public as $$
  select case when p_tipo = 'dato'
              then p_result is not null or nullif(trim(p_texto),'') is not null or p_valor is not null
              else p_result is not null end
$$;

-- Marca interna: las funciones oficiales (RPC) la encienden para poder cambiar campos protegidos.
create or replace function public.en_rpc() returns boolean
language sql stable set search_path = public as $$ select coalesce(current_setting('app.rpc', true), '') = 'on' $$;

-- ---------- Calificación (transparente) ----------
-- Punto: Cumple = peso · Parcial = peso × factor · No cumple = 0 · N/A y Dato no cuentan.
-- Subproceso y Proceso: Σ obtenido ÷ Σ posible.
-- Total: promedio de procesos ponderado por el peso de cada proceso.
create or replace function public.puntaje_auditoria(p_audit_id uuid) returns jsonb
language sql stable set search_path = public as $$
with pf as (select public.config('parcial_factor', 0.5) as f),
a as (select * from audits where id = p_audit_id),
it as (
  select i.id as item_id, sb.id as sub_id, sb.name as sub_name, sb.sort as sub_sort, sb.is_default,
         s.id as sec_id, s.name as sec_name, s.sort as sec_sort, s.weight as sec_weight,
         case when i.item_type <> 'dato' and r.result in ('cumple','parcial','no_cumple')
              then i.weight else 0 end as posible,
         case when i.item_type = 'dato' then 0
              when r.result = 'cumple'  then i.weight
              when r.result = 'parcial' then i.weight * (select f from pf)
              else 0 end as obtenido
  from a
  join audit_sections s     on s.template_version_id = a.template_version_id
  join audit_subsections sb on sb.section_id = s.id
  join audit_items i        on i.subsection_id = sb.id
  left join audit_responses r on r.audit_id = a.id and r.item_id = i.id
),
sub as (select sec_id, sub_id, sub_name, sub_sort, bool_and(is_default) as is_default,
               sum(obtenido) e, sum(posible) p from it group by 1,2,3,4),
sec as (select sec_id, sec_name, sec_sort, sec_weight, sum(obtenido) e, sum(posible) p
        from it group by 1,2,3,4),
tot as (select sum(sec_weight * e / p) / nullif(sum(sec_weight), 0) as pct from sec where p > 0)
select jsonb_build_object(
  'total', round((select pct from tot) * 100, 2),
  'procesos', coalesce((select jsonb_agg(jsonb_build_object(
      'id', sec.sec_id, 'nombre', sec.sec_name, 'peso', sec.sec_weight,
      'obtenido', sec.e, 'posible', sec.p,
      'pct', case when sec.p > 0 then round(sec.e / sec.p * 100, 2) end,
      'subprocesos', (select jsonb_agg(jsonb_build_object(
           'id', sub.sub_id, 'nombre', sub.sub_name, 'general', sub.is_default,
           'obtenido', sub.e, 'posible', sub.p,
           'pct', case when sub.p > 0 then round(sub.e / sub.p * 100, 2) end) order by sub.sub_sort)
         from sub where sub.sec_id = sec.sec_id)
    ) order by sec.sec_sort) from sec), '[]'::jsonb),
  'puntos', coalesce((select jsonb_agg(jsonb_build_object(
      'item_id', item_id, 'obtenido', obtenido, 'posible', posible)) from it), '[]'::jsonb)
)
$$;

-- ---------- Candados (triggers) ----------
-- Auditoría: fuera de las funciones oficiales solo se editan los comentarios de cierre, y solo en curso.
create or replace function public.tg_audits_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.en_rpc() then return new; end if;
  if old.status <> 'en_curso' then
    raise exception 'La auditoría no está en curso; no se puede modificar.';
  end if;
  if (to_jsonb(new) - array['general_comments','strengths','opportunities','updated_at'])
     <> (to_jsonb(old) - array['general_comments','strengths','opportunities','updated_at']) then
    raise exception 'Solo se pueden editar comentarios, fortalezas y oportunidades.';
  end if;
  return new;
end $$;
create trigger audits_guard before update on public.audits
  for each row execute function public.tg_audits_guard();

create or replace function public.assert_auditoria_en_curso(p_audit_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.audits where id = p_audit_id and status = 'en_curso') then
    raise exception 'La auditoría no está en curso; no se puede modificar.';
  end if;
end $$;

-- Respuestas: solo con auditoría en curso; si fue reabierta, se registra cada cambio.
create or replace function public.tg_responses_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_audit uuid := coalesce(new.audit_id, old.audit_id); v_reab int;
begin
  perform public.assert_auditoria_en_curso(v_audit);
  select reopened_count into v_reab from public.audits where id = v_audit;
  if v_reab > 0 then
    insert into public.audit_change_log(audit_id, table_name, record_id, action, old_data, new_data)
    values (v_audit, 'audit_responses', coalesce(new.id, old.id)::text, lower(tg_op),
            case when tg_op <> 'INSERT' then to_jsonb(old) end,
            case when tg_op <> 'DELETE' then to_jsonb(new) end);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.answered_by := coalesce(auth.uid(), new.answered_by);
  return new;
end $$;
create trigger responses_guard before insert or update or delete on public.audit_responses
  for each row execute function public.tg_responses_guard();

-- Evidencias: auditoría en curso + contexto completo automático (sucursal, líder, proceso, respuesta).
create or replace function public.tg_evidence_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_auditoria_en_curso(coalesce(new.audit_id, old.audit_id));
  if tg_op = 'DELETE' then return old; end if;
  if new.storage_path not like new.audit_id::text || '/%' then
    raise exception 'La ruta de la foto debe iniciar con el id de la auditoría.';
  end if;
  select a.branch_id, a.leader_id into new.branch_id, new.leader_id
    from public.audits a where a.id = new.audit_id;
  select sb.section_id into new.section_id
    from public.audit_items i join public.audit_subsections sb on sb.id = i.subsection_id
   where i.id = new.item_id;
  if new.response_id is null then
    select id into new.response_id from public.audit_responses
     where audit_id = new.audit_id and item_id = new.item_id;
  end if;
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end $$;
create trigger evidence_guard before insert or update or delete on public.audit_evidence
  for each row execute function public.tg_evidence_guard();

-- Planes de acción: se crean/editan con la auditoría en curso; después solo cambia el estatus (vía RPC).
create or replace function public.tg_plans_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_open boolean; v_reab int;
begin
  select status = 'en_curso', reopened_count into v_open, v_reab
    from public.audits where id = coalesce(new.audit_id, old.audit_id);

  if tg_op = 'INSERT' then
    if not v_open then raise exception 'La auditoría no está en curso; no se puede crear el plan.'; end if;
    select a.branch_id, a.audit_type_id into new.branch_id, new.audit_type_id
      from public.audits a where a.id = new.audit_id;
    if new.item_id is not null then
      select sb.section_id into new.section_id
        from public.audit_items i join public.audit_subsections sb on sb.id = i.subsection_id
       where i.id = new.item_id;
      if new.response_id is null then
        select id into new.response_id from public.audit_responses
         where audit_id = new.audit_id and item_id = new.item_id;
      end if;
    end if;
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.status := 'pendiente';
    return new;
  end if;

  if tg_op = 'DELETE' then
    if not v_open then raise exception 'La auditoría está cerrada; el plan no se puede borrar.'; end if;
    return old;
  end if;

  -- UPDATE
  if (new.status, new.closed_at, new.closed_by) is distinct from (old.status, old.closed_at, old.closed_by)
     and not public.en_rpc() then
    raise exception 'El estatus se cambia desde "Actualizar estatus" para que quede en la bitácora.';
  end if;
  if not v_open and not public.en_rpc() then
    raise exception 'La auditoría está cerrada; solo se puede actualizar el estatus del plan.';
  end if;
  if v_open and v_reab > 0 then
    insert into public.audit_change_log(audit_id, table_name, record_id, action, old_data, new_data)
    values (new.audit_id, 'action_plans', new.id::text, 'update', to_jsonb(old), to_jsonb(new));
  end if;
  return new;
end $$;
create trigger plans_guard before insert or update or delete on public.action_plans
  for each row execute function public.tg_plans_guard();

-- Catálogo: solo se editan versiones en "borrador". Lo publicado queda intacto para el histórico.
create or replace function public.tg_catalogo_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_version int; v_status public.template_status;
begin
  if tg_table_name = 'audit_sections' then
    v_version := coalesce(new.template_version_id, old.template_version_id);
  elsif tg_table_name = 'audit_subsections' then
    select template_version_id into v_version from public.audit_sections
     where id = coalesce(new.section_id, old.section_id);
  else
    select s.template_version_id into v_version
      from public.audit_subsections sb join public.audit_sections s on s.id = sb.section_id
     where sb.id = coalesce(new.subsection_id, old.subsection_id);
  end if;
  select status into v_status from public.template_versions where id = v_version;
  if v_status <> 'borrador' then
    raise exception 'Esta versión del catálogo ya está publicada. Crea una nueva versión para editarla.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger sections_guard    before insert or update or delete on public.audit_sections
  for each row execute function public.tg_catalogo_guard();
create trigger subsections_guard before insert or update or delete on public.audit_subsections
  for each row execute function public.tg_catalogo_guard();
create trigger items_guard       before insert or update or delete on public.audit_items
  for each row execute function public.tg_catalogo_guard();

-- =====================================================================
-- Funciones oficiales (RPC) que llama la app
-- =====================================================================

-- Iniciar (o continuar) la auditoría de una sucursal en la semana actual.
create or replace function public.iniciar_auditoria(p_branch_id int)
returns public.audits language plpgsql security definer set search_path = public as $$
declare v_tipo int; v_rol text; v_version int; v_semana date := public.inicio_semana(); v_a audits;
begin
  v_rol := public.mi_rol();
  if v_rol is null or v_rol = 'socio' then
    raise exception 'Solo los líderes pueden iniciar auditorías.';
  end if;
  v_tipo := public.mi_tipo_auditoria();
  if not exists (select 1 from branches where id = p_branch_id and active) then
    raise exception 'Sucursal no válida.';
  end if;

  select * into v_a from audits
   where branch_id = p_branch_id and audit_type_id = v_tipo
     and week_start = v_semana and status <> 'cancelada';
  if found then
    if v_a.status = 'en_curso' and v_a.leader_id = auth.uid() then
      return v_a;                                   -- continuar la existente
    elsif v_a.status = 'en_curso' then
      raise exception 'Otro líder tiene esta auditoría en curso esta semana.';
    else
      raise exception 'Esta sucursal ya fue auditada esta semana.';
    end if;
  end if;

  select id into v_version from template_versions
   where audit_type_id = v_tipo and status = 'publicada';
  if v_version is null then
    raise exception 'No hay catálogo publicado para este tipo de auditoría.';
  end if;

  perform set_config('app.rpc', 'on', true);
  insert into audits(template_version_id, audit_type_id, branch_id, leader_id,
                     week_start, audit_date, started_at, last_heartbeat_at)
  values (v_version, v_tipo, p_branch_id, auth.uid(), v_semana, public.hoy(), now(), now())
  returning * into v_a;
  return v_a;
end $$;

-- Latido: la app lo llama cada minuto mientras la auditoría está abierta en pantalla.
-- Suma tiempo activo; si pasaron más de 5 min sin latido (app cerrada), ese hueco no se cuenta.
create or replace function public.latido_auditoria(p_audit_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_a audits; v_delta int;
begin
  select * into v_a from audits where id = p_audit_id for update;
  if v_a.leader_id is distinct from auth.uid() or v_a.status <> 'en_curso' then
    return null;
  end if;
  v_delta := coalesce(extract(epoch from now() - v_a.last_heartbeat_at)::int, 0);
  if v_delta > 300 then v_delta := 0; end if;
  perform set_config('app.rpc', 'on', true);
  update audits set active_seconds = active_seconds + v_delta, last_heartbeat_at = now()
   where id = p_audit_id;
  return v_a.active_seconds + v_delta;
end $$;

-- Cerrar: valida que todo esté respondido, calcula y congela calificaciones, guarda snapshot y bloquea.
create or replace function public.cerrar_auditoria(
  p_audit_id uuid, p_comentarios text default null,
  p_fortalezas text default null, p_oportunidades text default null)
returns public.audits language plpgsql security definer set search_path = public as $$
declare v_a audits; v_pend int; v_score jsonb; v_elapsed int; v_bajo boolean; v_ahora timestamptz := now();
begin
  select * into v_a from audits where id = p_audit_id for update;
  if not found then raise exception 'Auditoría no encontrada.'; end if;
  if v_a.leader_id <> auth.uid() then raise exception 'Solo el líder de esta auditoría puede cerrarla.'; end if;
  if v_a.status <> 'en_curso' then raise exception 'La auditoría no está en curso.'; end if;

  select count(*) into v_pend
    from audit_sections s
    join audit_subsections sb on sb.section_id = s.id
    join audit_items i on i.subsection_id = sb.id
    left join audit_responses r on r.audit_id = v_a.id and r.item_id = i.id
   where s.template_version_id = v_a.template_version_id
     and not coalesce(public.respuesta_completa(i.item_type, r.result, r.text_value, r.measurement_value), false);
  if v_pend > 0 then
    raise exception 'Faltan % puntos por responder.', v_pend;
  end if;

  -- Duración: en una reapertura se conserva la del primer cierre.
  if v_a.reopened_count > 0 and v_a.elapsed_seconds is not null then
    v_elapsed := v_a.elapsed_seconds; v_bajo := v_a.closed_under_target;
  else
    v_elapsed := extract(epoch from v_ahora - v_a.started_at)::int;
    v_bajo := coalesce(nullif(v_a.active_seconds, 0), v_elapsed)
              < public.config('advertencia_minutos', 180) * 60;
  end if;

  v_score := public.puntaje_auditoria(v_a.id);

  delete from audit_scores where audit_id = v_a.id;
  insert into audit_scores(audit_id, level, ref_id, earned, possible, pct)
  select v_a.id, 'punto', (p->>'item_id')::int, (p->>'obtenido')::numeric, (p->>'posible')::numeric,
         case when (p->>'posible')::numeric > 0
              then round((p->>'obtenido')::numeric / (p->>'posible')::numeric * 100, 2) end
    from jsonb_array_elements(v_score->'puntos') p;
  insert into audit_scores(audit_id, level, ref_id, earned, possible, pct)
  select v_a.id, 'proceso', (s->>'id')::int, (s->>'obtenido')::numeric, (s->>'posible')::numeric,
         (s->>'pct')::numeric
    from jsonb_array_elements(v_score->'procesos') s;
  insert into audit_scores(audit_id, level, ref_id, earned, possible, pct)
  select v_a.id, 'subproceso', (sb->>'id')::int, (sb->>'obtenido')::numeric, (sb->>'posible')::numeric,
         (sb->>'pct')::numeric
    from jsonb_array_elements(v_score->'procesos') s,
         jsonb_array_elements(s->'subprocesos') sb;
  insert into audit_scores(audit_id, level, earned, possible, pct)
  values (v_a.id, 'total', null, null, (v_score->>'total')::numeric);

  perform set_config('app.rpc', 'on', true);
  update audits set
    status = 'cerrada', finished_at = v_ahora, elapsed_seconds = v_elapsed,
    closed_under_target = v_bajo,
    general_comments = coalesce(p_comentarios, general_comments),
    strengths        = coalesce(p_fortalezas, strengths),
    opportunities    = coalesce(p_oportunidades, opportunities),
    score_total      = (v_score->>'total')::numeric
  where id = v_a.id returning * into v_a;

  update audits set snapshot = public.construir_snapshot(v_a.id, v_score)
   where id = v_a.id returning * into v_a;
  return v_a;
end $$;

-- Snapshot: foto completa del resultado al cierre (base del PDF y del histórico).
create or replace function public.construir_snapshot(p_audit_id uuid, p_score jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'generado', now(),
    'encabezado', jsonb_build_object(
      'sucursal', b.name, 'tipo', t.name, 'tipo_codigo', t.code, 'lider', u.full_name,
      'fecha', a.audit_date, 'semana', a.week_start,
      'inicio', a.started_at, 'fin', a.finished_at,
      'duracion_seg', a.elapsed_seconds, 'tiempo_activo_seg', a.active_seconds,
      'bajo_objetivo', a.closed_under_target, 'version_catalogo', tv.version,
      'reaperturas', a.reopened_count),
    'calificacion', p_score - 'puntos',
    'cierre', jsonb_build_object('comentarios', a.general_comments,
                                 'fortalezas', a.strengths, 'oportunidades', a.opportunities),
    'respuestas', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'item_id', i.id, 'codigo', i.code, 'punto', i.text, 'tipo', i.item_type, 'peso', i.weight,
        'unidad', i.unit, 'proceso', s.name, 'proceso_id', s.id, 'subproceso', sb.name,
        'resultado', r.result, 'prioridad', r.priority, 'comentario', r.comment,
        'medicion', r.measurement_value, 'dato', r.text_value)
        order by s.sort, sb.sort, i.sort), '[]'::jsonb)
      from audit_sections s
      join audit_subsections sb on sb.section_id = s.id
      join audit_items i on i.subsection_id = sb.id
      left join audit_responses r on r.audit_id = a.id and r.item_id = i.id
      where s.template_version_id = a.template_version_id),
    'planes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'item_id', p.item_id, 'hallazgo', p.finding, 'accion', p.corrective_action,
        'responsable', p.responsible, 'prioridad', p.priority, 'fecha_compromiso', p.due_date,
        'estatus', p.status) order by p.created_at), '[]'::jsonb)
      from action_plans p where p.audit_id = a.id),
    'evidencias', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'item_id', e.item_id, 'plan_id', e.action_plan_id,
        'ruta', e.storage_path, 'miniatura', e.thumb_path, 'pie', e.caption)
        order by e.created_at), '[]'::jsonb)
      from audit_evidence e where e.audit_id = a.id)
  )
  from audits a
  join branches b on b.id = a.branch_id
  join audit_types t on t.id = a.audit_type_id
  join users u on u.id = a.leader_id
  join template_versions tv on tv.id = a.template_version_id
  where a.id = p_audit_id
$$;

-- Cancelar una auditoría en curso (iniciada por error). Cualquiera de los usuarios activos.
create or replace function public.cancelar_auditoria(p_audit_id uuid, p_motivo text default null)
returns public.audits language plpgsql security definer set search_path = public as $$
declare v_a audits;
begin
  if not public.es_usuario_activo() then raise exception 'No autorizado.'; end if;
  select * into v_a from audits where id = p_audit_id for update;
  if not found or v_a.status <> 'en_curso' then
    raise exception 'Solo se pueden cancelar auditorías en curso.';
  end if;
  perform set_config('app.rpc', 'on', true);
  update audits set status = 'cancelada', cancelled_at = now(), cancelled_by = auth.uid(),
                    cancel_reason = p_motivo
   where id = p_audit_id returning * into v_a;
  insert into audit_change_log(audit_id, table_name, record_id, action, reason)
  values (p_audit_id, 'audits', p_audit_id::text, 'cancelar', p_motivo);
  return v_a;
end $$;

-- Reabrir una auditoría cerrada. Solo socios, con motivo obligatorio.
create or replace function public.reabrir_auditoria(p_audit_id uuid, p_motivo text)
returns public.audits language plpgsql security definer set search_path = public as $$
declare v_a audits;
begin
  if not public.es_socio() then raise exception 'Solo los socios pueden reabrir auditorías.'; end if;
  if nullif(trim(p_motivo), '') is null then raise exception 'El motivo es obligatorio.'; end if;
  select * into v_a from audits where id = p_audit_id for update;
  if not found or v_a.status <> 'cerrada' then
    raise exception 'Solo se pueden reabrir auditorías cerradas.';
  end if;
  insert into audit_change_log(audit_id, table_name, record_id, action, old_data, reason)
  values (p_audit_id, 'audits', p_audit_id::text, 'reabrir',
          jsonb_build_object('score_total', v_a.score_total, 'finished_at', v_a.finished_at,
                             'snapshot', v_a.snapshot), p_motivo);
  perform set_config('app.rpc', 'on', true);
  update audits set status = 'en_curso', reopened_count = reopened_count + 1,
                    last_heartbeat_at = null
   where id = p_audit_id returning * into v_a;
  return v_a;
end $$;

-- Cambiar estatus de un plan de acción (solo quien lo creó). Queda en la bitácora.
create or replace function public.actualizar_estatus_plan(
  p_plan_id uuid, p_estatus public.action_status, p_comentario text default null)
returns public.action_plans language plpgsql security definer set search_path = public as $$
declare v_p action_plans;
begin
  select * into v_p from action_plans where id = p_plan_id for update;
  if not found then raise exception 'Plan no encontrado.'; end if;
  if v_p.created_by <> auth.uid() then
    raise exception 'Solo el líder que creó el plan puede actualizar su estatus.';
  end if;
  if v_p.status = p_estatus and nullif(trim(p_comentario), '') is null then
    raise exception 'El plan ya tiene ese estatus; agrega un comentario si quieres registrar avance.';
  end if;
  insert into action_plan_updates(action_plan_id, from_status, to_status, comment, created_by)
  values (p_plan_id, v_p.status, p_estatus, p_comentario, auth.uid());
  perform set_config('app.rpc', 'on', true);
  update action_plans set status = p_estatus,
         closed_at = case when p_estatus = 'corregido' then now() end,
         closed_by = case when p_estatus = 'corregido' then auth.uid() end
   where id = p_plan_id returning * into v_p;
  return v_p;
end $$;

-- Catálogo: crear un borrador copiando la versión publicada (para editar puntos o pesos).
create or replace function public.crear_borrador_catalogo(p_audit_type_id int)
returns int language plpgsql security definer set search_path = public as $$
declare v_src int; v_new int; r_s record; r_sb record; v_s int; v_sb int;
begin
  if not public.es_socio() then raise exception 'Solo los socios pueden editar el catálogo.'; end if;
  if exists (select 1 from template_versions where audit_type_id = p_audit_type_id and status = 'borrador') then
    raise exception 'Ya existe un borrador para este tipo; edítalo o publícalo.';
  end if;
  select id into v_src from template_versions where audit_type_id = p_audit_type_id and status = 'publicada';
  insert into template_versions(audit_type_id, version, status)
  values (p_audit_type_id,
          (select coalesce(max(version), 0) + 1 from template_versions where audit_type_id = p_audit_type_id),
          'borrador')
  returning id into v_new;
  for r_s in select * from audit_sections where template_version_id = v_src loop
    insert into audit_sections(template_version_id, code, name, sort, weight)
    values (v_new, r_s.code, r_s.name, r_s.sort, r_s.weight) returning id into v_s;
    for r_sb in select * from audit_subsections where section_id = r_s.id loop
      insert into audit_subsections(section_id, name, sort, is_default)
      values (v_s, r_sb.name, r_sb.sort, r_sb.is_default) returning id into v_sb;
      insert into audit_items(subsection_id, code, text, original_text, guidance, sort,
                              item_type, weight, unit, allow_na)
      select v_sb, code, text, original_text, guidance, sort, item_type, weight, unit, allow_na
        from audit_items where subsection_id = r_sb.id;
    end loop;
  end loop;
  return v_new;
end $$;

-- Catálogo: publicar un borrador (la versión anterior pasa a "retirada"; sus auditorías no cambian).
create or replace function public.publicar_catalogo(p_version_id int)
returns void language plpgsql security definer set search_path = public as $$
declare v_tipo int;
begin
  if not public.es_socio() then raise exception 'Solo los socios pueden publicar el catálogo.'; end if;
  select audit_type_id into v_tipo from template_versions where id = p_version_id and status = 'borrador';
  if v_tipo is null then raise exception 'Solo se pueden publicar borradores.'; end if;
  update template_versions set status = 'retirada' where audit_type_id = v_tipo and status = 'publicada';
  update template_versions set status = 'publicada', published_at = now() where id = p_version_id;
end $$;

-- ---------- Permisos de ejecución ----------
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated;

-- =====================================================================
-- Cofki Auditorías · 03 · Seguridad (Row Level Security)
-- Reglas:
--  · Todo usuario activo puede CONSULTAR (líderes ven el otro tipo en solo lectura).
--  · Líder: edita solo SUS auditorías y solo mientras están en curso.
--  · Líder: cambia estatus solo de los planes que él creó (vía función).
--  · Socios: no capturan; reabren auditorías y administran catálogo/configuración.
--  · Iniciar, cerrar, cancelar y reabrir solo por funciones oficiales (no hay insert directo).
-- =====================================================================

alter table public.roles               enable row level security;
alter table public.branches            enable row level security;
alter table public.audit_types         enable row level security;
alter table public.users               enable row level security;
alter table public.scoring_config      enable row level security;
alter table public.template_versions   enable row level security;
alter table public.audit_sections      enable row level security;
alter table public.audit_subsections   enable row level security;
alter table public.audit_items         enable row level security;
alter table public.audits              enable row level security;
alter table public.audit_responses     enable row level security;
alter table public.action_plans        enable row level security;
alter table public.action_plan_updates enable row level security;
alter table public.audit_evidence      enable row level security;
alter table public.audit_scores        enable row level security;
alter table public.audit_change_log    enable row level security;

-- ---------- Lectura para cualquier usuario activo ----------
do $$
declare t text;
begin
  foreach t in array array['roles','branches','audit_types','users','scoring_config','template_versions',
    'audit_sections','audit_subsections','audit_items','audits','audit_responses','action_plans',
    'action_plan_updates','audit_evidence','audit_scores','audit_change_log']
  loop
    execute format('create policy "lectura_usuarios_activos" on public.%I for select to authenticated using (public.es_usuario_activo())', t);
  end loop;
end $$;

-- ---------- Configuración y catálogo: socios ----------
create policy "socios_editan_config" on public.scoring_config
  for update to authenticated using (public.es_socio()) with check (public.es_socio());

do $$
declare t text;
begin
  foreach t in array array['audit_sections','audit_subsections','audit_items'] loop
    execute format('create policy "socios_insertan" on public.%I for insert to authenticated with check (public.es_socio())', t);
    execute format('create policy "socios_editan"   on public.%I for update to authenticated using (public.es_socio()) with check (public.es_socio())', t);
    execute format('create policy "socios_borran"   on public.%I for delete to authenticated using (public.es_socio())', t);
  end loop;
end $$;
-- (Solo versiones en borrador; lo valida el trigger del catálogo.)

-- ---------- Auditorías ----------
-- Sin insert/delete directo: se crean con iniciar_auditoria().
create policy "lider_edita_su_auditoria" on public.audits
  for update to authenticated
  using (leader_id = auth.uid() and status = 'en_curso')
  with check (leader_id = auth.uid());

-- ---------- Respuestas y evidencias: dueño de la auditoría en curso ----------
create or replace function public.soy_dueno_en_curso(p_audit_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from audits
                  where id = p_audit_id and leader_id = auth.uid() and status = 'en_curso')
$$;
grant execute on function public.soy_dueno_en_curso(uuid) to authenticated;
revoke execute on function public.soy_dueno_en_curso(uuid) from public, anon;

create policy "dueno_inserta" on public.audit_responses for insert to authenticated
  with check (public.soy_dueno_en_curso(audit_id));
create policy "dueno_edita"   on public.audit_responses for update to authenticated
  using (public.soy_dueno_en_curso(audit_id)) with check (public.soy_dueno_en_curso(audit_id));
create policy "dueno_borra"   on public.audit_responses for delete to authenticated
  using (public.soy_dueno_en_curso(audit_id));

create policy "dueno_inserta" on public.audit_evidence for insert to authenticated
  with check (public.soy_dueno_en_curso(audit_id));
create policy "dueno_edita"   on public.audit_evidence for update to authenticated
  using (public.soy_dueno_en_curso(audit_id)) with check (public.soy_dueno_en_curso(audit_id));
create policy "dueno_borra"   on public.audit_evidence for delete to authenticated
  using (public.soy_dueno_en_curso(audit_id));

-- ---------- Planes de acción ----------
create policy "dueno_crea_plan" on public.action_plans for insert to authenticated
  with check (public.soy_dueno_en_curso(audit_id));
create policy "creador_edita_plan" on public.action_plans for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "creador_borra_plan" on public.action_plans for delete to authenticated
  using (created_by = auth.uid() and public.soy_dueno_en_curso(audit_id));

-- action_plan_updates, audit_scores, audit_change_log, users, template_versions:
-- sin políticas de escritura → solo se escriben desde funciones oficiales o desde el panel de Supabase.

-- =====================================================================
-- Cofki Auditorías · 04 · Vistas para pantallas y dashboards
-- (security_invoker: respetan los permisos del usuario que consulta)
-- =====================================================================

-- Avance de cada auditoría (barra de progreso y "qué falta")
create view public.v_audit_progress with (security_invoker = true) as
select a.id as audit_id,
       count(i.id) as total_puntos,
       count(i.id) filter (where public.respuesta_completa(i.item_type, r.result, r.text_value, r.measurement_value)) as respondidos,
       count(i.id) filter (where r.result in ('parcial','no_cumple')) as hallazgos,
       count(i.id) filter (where r.result in ('parcial','no_cumple') and r.priority = 'critica') as hallazgos_criticos
from public.audits a
join public.audit_sections s     on s.template_version_id = a.template_version_id
join public.audit_subsections sb on sb.section_id = s.id
join public.audit_items i        on i.subsection_id = sb.id
left join public.audit_responses r on r.audit_id = a.id and r.item_id = i.id
group by a.id;

-- Avance por proceso dentro de una auditoría (índice de procesos)
create view public.v_audit_section_progress with (security_invoker = true) as
select a.id as audit_id, s.id as section_id, s.name as section_name, s.sort,
       count(i.id) as total_puntos,
       count(i.id) filter (where public.respuesta_completa(i.item_type, r.result, r.text_value, r.measurement_value)) as respondidos,
       count(i.id) filter (where r.result in ('parcial','no_cumple')) as hallazgos
from public.audits a
join public.audit_sections s     on s.template_version_id = a.template_version_id
join public.audit_subsections sb on sb.section_id = s.id
join public.audit_items i        on i.subsection_id = sb.id
left join public.audit_responses r on r.audit_id = a.id and r.item_id = i.id
group by a.id, s.id, s.name, s.sort;

-- Resumen semanal: una fila por semana × sucursal × tipo (detecta "no realizada")
create view public.weekly_summary with (security_invoker = true) as
with semanas as (
  select generate_series(
           coalesce((select min(week_start) from public.audits), public.inicio_semana()),
           public.inicio_semana(), interval '7 days')::date as week_start
)
select w.week_start, b.id as branch_id, b.name as branch_name, b.sort as branch_sort,
       t.id as audit_type_id, t.code as audit_type_code, t.name as audit_type_name,
       a.id as audit_id, a.status, a.leader_id, u.full_name as leader_name,
       a.score_total, a.started_at, a.finished_at, a.elapsed_seconds, a.active_seconds,
       a.closed_under_target,
       case when a.id is null then 'no_realizada'
            when a.status = 'en_curso' then 'en_curso'
            else 'cerrada' end as estado_semana
from semanas w
cross join public.branches b
cross join public.audit_types t
left join public.audits a on a.week_start = w.week_start and a.branch_id = b.id
                         and a.audit_type_id = t.id and a.status <> 'cancelada'
left join public.users u on u.id = a.leader_id
where b.active and t.active;

-- Calificación por sucursal y semana (A&B, Front y total ponderado)
create view public.v_branch_week_scores with (security_invoker = true) as
select ws.week_start, ws.branch_id, ws.branch_name, ws.branch_sort,
       max(ws.score_total) filter (where ws.audit_type_code = 'AB'    and ws.status = 'cerrada') as score_ab,
       max(ws.score_total) filter (where ws.audit_type_code = 'FRONT' and ws.status = 'cerrada') as score_front,
       round(sum(ws.score_total * public.config('peso_sucursal_' || ws.audit_type_code, 0.5))
               filter (where ws.status = 'cerrada')
             / nullif(sum(public.config('peso_sucursal_' || ws.audit_type_code, 0.5))
               filter (where ws.status = 'cerrada'), 0), 2) as score_total,
       count(*) filter (where ws.status = 'cerrada') as auditorias_cerradas,
       count(*) as auditorias_programadas
from public.weekly_summary ws
group by ws.week_start, ws.branch_id, ws.branch_name, ws.branch_sort;

-- Planes de acción con banderas de vencido / próximo a vencer
create view public.v_action_plans with (security_invoker = true) as
select p.*,
       b.name as branch_name, t.code as audit_type_code, t.name as audit_type_name,
       s.name as section_name, i.code as item_code, i.text as item_text,
       u.full_name as created_by_name, a.week_start, a.leader_id,
       public.plan_abierto(p.status) as abierto,
       public.plan_abierto(p.status) and p.due_date < public.hoy() as vencido,
       public.plan_abierto(p.status) and p.due_date >= public.hoy()
         and p.due_date <= public.hoy() + public.config('dias_proxima_vencer', 3)::int as proximo_a_vencer,
       greatest(public.hoy() - p.due_date, 0) as dias_vencido
from public.action_plans p
join public.audits a on a.id = p.audit_id
left join public.branches b    on b.id = p.branch_id
left join public.audit_types t on t.id = p.audit_type_id
left join public.audit_sections s on s.id = p.section_id
left join public.audit_items i    on i.id = p.item_id
left join public.users u          on u.id = p.created_by
where a.status <> 'cancelada';

-- =====================================================================
-- Cofki Auditorías · 05 · Storage de evidencias (bucket privado)
-- Ruta de cada foto: {audit_id}/{item_id}/{uuid}.jpg  (+ _thumb.jpg)
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidencias', 'evidencias', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create or replace function public.audit_id_de_ruta(p_name text) returns uuid
language plpgsql immutable set search_path = public as $$
begin
  return (split_part(p_name, '/', 1))::uuid;
exception when others then
  return null;
end $$;
grant execute on function public.audit_id_de_ruta(text) to authenticated;

create policy "evidencias_lectura" on storage.objects for select to authenticated
  using (bucket_id = 'evidencias' and public.es_usuario_activo());

create policy "evidencias_subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'evidencias'
              and public.soy_dueno_en_curso(public.audit_id_de_ruta(name)));

create policy "evidencias_borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'evidencias'
         and public.soy_dueno_en_curso(public.audit_id_de_ruta(name)));

-- =====================================================================
-- Cofki Auditorías · 06 · Datos base (roles, sucursales, tipos, configuración)
-- =====================================================================

insert into public.roles (code, name) values
  ('lider_ab',    'Líder de Alimentos y Bebidas'),
  ('lider_front', 'Líder de Servicio, Caja y Nannies'),
  ('socio',       'Socio / Administrador');

insert into public.branches (code, name, sort) values
  ('AURORA', 'Aurora',        1),
  ('GM3',    'GM3',           2),
  ('SERENA', 'Pueblo Serena', 3);

insert into public.audit_types (code, name, target_min_minutes, target_max_minutes, sort) values
  ('AB',    'Alimentos y Bebidas',         180, 240, 1),
  ('FRONT', 'Servicio, Caja y Nannies',    180, 240, 2);

insert into public.scoring_config (key, value, description) values
  ('parcial_factor',          0.5, 'Valor de "Cumple parcialmente" (0.5 = 50 %)'),
  ('advertencia_minutos',     180, 'Si la auditoría dura menos, se advierte al cerrar'),
  ('dias_proxima_vencer',       3, 'Días antes de la fecha compromiso para alertar'),
  ('caida_importante_puntos',  10, 'Caída vs. semana anterior que dispara alerta'),
  ('recurrente_semanas',        2, 'Semanas seguidas con No cumple = problema recurrente'),
  ('peso_sucursal_AB',        0.5, 'Peso de A&B en la calificación de sucursal'),
  ('peso_sucursal_FRONT',     0.5, 'Peso de Front en la calificación de sucursal');

-- =====================================================================
-- Cofki Auditorías · 07 · Catálogo v1 (PRUEBA)
-- Generado desde Catalogo_Auditorias_Cofki.xlsx (propuesta aún en revisión).
-- Sirve para probar la app. Antes de salir a producción se reemplaza por la versión aprobada.
-- =====================================================================

do $$
declare v int; s int; sb int;
begin
  insert into public.template_versions(audit_type_id, version, status, notes)
  values ((select id from public.audit_types where code = 'AB'), 1, 'borrador', 'v1 de prueba — pendiente de aprobación')
  returning id into v;

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'AB-01', 'Personal A&B', 1, 1) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Higiene y presentación', 1, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-001', 'Uniforme completo, limpio y en buen estado', 'Uniforme completo y limpio', 1, 'evaluable', 2, null),
    (sb, 'AB-002', 'Cofia colocada y cabello completamente cubierto', 'Cofia y cabello correctamente cubiertos', 2, 'evaluable', 3, null),
    (sb, 'AB-003', 'Manos, uñas y barba en condiciones adecuadas (cortas, limpias, sin joyería)', 'Manos, uñas y barba en condiciones adecuadas', 3, 'evaluable', 3, null),
    (sb, 'AB-004', 'Hábitos de higiene correctos durante la operación', 'Hábitos correctos de higiene', 4, 'evaluable', 3, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Conducta y disciplina', 2, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-005', 'Trato respetuoso entre el equipo', 'Trato respetuoso', 5, 'evaluable', 1, null),
    (sb, 'AB-006', 'Comportamiento profesional en la estación', 'Comportamiento profesional', 6, 'evaluable', 1, null),
    (sb, 'AB-007', 'Instrucciones del líder/gerente se cumplen', 'Cumplimiento de instrucciones', 7, 'evaluable', 2, null),
    (sb, 'AB-008', 'Celular usado solo conforme a la política', 'Uso correcto del celular', 8, 'evaluable', 1, null),
    (sb, 'AB-009', 'Personal llega y opera en su horario asignado', 'Puntualidad y horarios', 9, 'evaluable', 2, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Organización y productividad', 3, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-010', 'Estaciones asignadas correctamente', 'Estaciones correctamente asignadas', 10, 'evaluable', 1, null),
    (sb, 'AB-011', 'Cada colaborador conoce sus funciones', 'Funciones claras', 11, 'evaluable', 1, null),
    (sb, 'AB-012', 'Personal suficiente para la operación del turno', 'Personal suficiente', 12, 'evaluable', 2, null),
    (sb, 'AB-013', 'Flujo de trabajo ordenado', 'Flujo de trabajo ordenado', 13, 'evaluable', 1, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'AB-02', 'Inocuidad y seguridad alimentaria', 2, 3) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Manipulación', 1, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-014', 'Lavado de manos correcto y en los momentos requeridos', 'Lavado correcto de manos', 14, 'evaluable', 3, null),
    (sb, 'AB-015', 'Se previene la contaminación cruzada', 'Prevención de contaminación cruzada', 15, 'evaluable', 3, null),
    (sb, 'AB-016', 'Crudos y cocidos almacenados y manipulados por separado', 'Separación de crudos y cocidos', 16, 'evaluable', 3, null),
    (sb, 'AB-017', 'Utensilios y superficies usados correctamente (tablas/colores por tipo)', 'Uso correcto de utensilios y superficies', 17, 'evaluable', 3, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Control de alimentos', 2, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-018', 'Productos etiquetados', 'Etiquetado', 18, 'evaluable', 3, null),
    (sb, 'AB-019', 'Etiquetas con fecha de producción', 'Fecha de producción', 19, 'evaluable', 2, null),
    (sb, 'AB-020', 'Etiquetas con fecha de caducidad', 'Fecha de caducidad', 20, 'evaluable', 3, null),
    (sb, 'AB-021', 'Productos en buen estado', 'Producto en buen estado', 21, 'evaluable', 3, null),
    (sb, 'AB-022', 'Sin productos sin identificación ni vencidos', 'Productos sin identificación o vencidos', 22, 'evaluable', 3, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Almacenamiento', 3, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-023', 'Alimentos protegidos/tapados', 'Alimentos protegidos', 23, 'evaluable', 3, null),
    (sb, 'AB-024', 'Ningún producto en el piso', 'Productos fuera del piso', 24, 'evaluable', 2, null),
    (sb, 'AB-025', 'Químicos separados de alimentos', 'Químicos separados', 25, 'evaluable', 3, null),
    (sb, 'AB-026', 'Contenedores adecuados y cerrados', 'Contenedores adecuados y cerrados', 26, 'evaluable', 2, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Temperaturas', 4, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-027', 'Temperatura de refrigeradores dentro del estándar', 'Refrigeradores dentro del estándar', 27, 'medicion', 3, '°C · estándar por confirmar (ej. 0–4 °C)'),
    (sb, 'AB-028', 'Temperatura de congeladores dentro del estándar', 'Congeladores dentro del estándar', 28, 'medicion', 3, '°C · estándar por confirmar (ej. ≤ -18 °C)'),
    (sb, 'AB-029', 'Productos preparados conservados a la temperatura correcta', 'Productos preparados correctamente conservados', 29, 'evaluable', 3, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'AB-03', 'Refrigeración y almacén', 3, 2) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Refrigeración', 1, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-030', 'Refrigeración: temperatura correcta en todos los equipos', 'Temperatura', 30, 'evaluable', 3, null),
    (sb, 'AB-031', 'Refrigeración: equipos limpios', 'Limpieza', 31, 'evaluable', 2, null),
    (sb, 'AB-032', 'Refrigeración: empaques en buen estado', 'Empaques', 32, 'evaluable', 1, null),
    (sb, 'AB-033', 'Refrigeración: puertas cierran correctamente', 'Puertas', 33, 'evaluable', 2, null),
    (sb, 'AB-034', 'Refrigeración: iluminación interior funcionando', 'Iluminación', 34, 'evaluable', 1, null),
    (sb, 'AB-035', 'Refrigeración: equipos funcionando correctamente', 'Funcionamiento', 35, 'evaluable', 3, null),
    (sb, 'AB-036', 'Refrigeración: acomodo correcto (por tipo, crudos abajo)', 'Acomodo', 36, 'evaluable', 2, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Rotación', 2, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-037', 'Rotación PEP (primeras entradas, primeras salidas) cumplida', 'Cumplimiento de PEP', 37, 'evaluable', 2, null),
    (sb, 'AB-038', 'Caducidades vigentes en refrigeración y almacén', 'Caducidades', 38, 'evaluable', 3, null),
    (sb, 'AB-039', 'Productos próximos a caducar identificados y con plan de uso', 'Productos próximos a caducar', 39, 'evaluable', 2, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Almacén', 3, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-040', 'Almacén ordenado', 'Orden', 40, 'evaluable', 1, null),
    (sb, 'AB-041', 'Almacén limpio', 'Limpieza', 41, 'evaluable', 2, null),
    (sb, 'AB-042', 'Almacén con acomodo correcto', 'Acomodo', 42, 'evaluable', 1, null),
    (sb, 'AB-043', 'Productos sin movimiento identificados', 'Productos sin movimiento', 43, 'evaluable', 1, null),
    (sb, 'AB-044', 'Sin faltantes de insumos en almacén', 'Faltantes', 44, 'evaluable', 2, null),
    (sb, 'AB-045', 'Sin sobreinventarios en almacén', 'Sobreinventarios', 45, 'evaluable', 1, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'AB-04', 'Cocina: equipos, utensilios e instalaciones', 4, 2) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Equipos', 1, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-046', 'Equipos de cocina funcionando', 'Funcionamiento', 46, 'evaluable', 2, null),
    (sb, 'AB-047', 'Equipos de cocina limpios', 'Limpieza', 47, 'evaluable', 2, null),
    (sb, 'AB-048', 'Equipos de cocina en buena condición física', 'Condición física', 48, 'evaluable', 1, null),
    (sb, 'AB-049', 'Equipos de cocina operan de forma segura', 'Seguridad', 49, 'evaluable', 3, null),
    (sb, 'AB-050', 'Mantenimiento preventivo de equipos al día', 'Mantenimiento preventivo', 50, 'evaluable', 2, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Utensilios', 2, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-051', 'Utensilios en buena condición', 'Condición', 51, 'evaluable', 1, null),
    (sb, 'AB-052', 'Utensilios limpios', 'Limpieza', 52, 'evaluable', 2, null),
    (sb, 'AB-053', 'Cantidad suficiente de utensilios', 'Cantidad suficiente', 53, 'evaluable', 1, null),
    (sb, 'AB-054', 'Utensilios acomodados correctamente', 'Acomodo', 54, 'evaluable', 1, null),
    (sb, 'AB-055', 'Sin utensilios faltantes o dañados', 'Faltantes o dañados', 55, 'evaluable', 1, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Instalaciones y mantenimiento', 3, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-056', 'Sin fugas de agua', 'Fugas de agua', 56, 'evaluable', 2, null),
    (sb, 'AB-057', 'Sin fugas de gas', 'Fugas de gas', 57, 'evaluable', 3, null),
    (sb, 'AB-058', 'Contactos y cables en condiciones seguras', 'Contactos y cables', 58, 'evaluable', 3, null),
    (sb, 'AB-059', 'Iluminación de cocina funcionando', 'Iluminación', 59, 'evaluable', 1, null),
    (sb, 'AB-060', 'Drenajes funcionando y limpios', 'Drenajes', 60, 'evaluable', 2, null),
    (sb, 'AB-061', 'Extracción funcionando', 'Extracción', 61, 'evaluable', 2, null),
    (sb, 'AB-062', 'Campana limpia y funcionando', 'Campana', 62, 'evaluable', 2, null),
    (sb, 'AB-063', 'Problemas reportados en auditorías previas atendidos', 'Seguimiento de problemas previamente reportados', 63, 'evaluable', 2, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'AB-05', 'Producción de cocina', 5, 2) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Producción', 1, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-064', 'Producciones completas para el turno', 'Producciones completas', 64, 'evaluable', 2, null),
    (sb, 'AB-065', 'Cantidad producida acorde a la necesidad', 'Cantidad acorde a necesidad', 65, 'evaluable', 1, null),
    (sb, 'AB-066', 'Producción sin atrasos', 'Atrasos', 66, 'evaluable', 1, null),
    (sb, 'AB-067', 'Sin faltantes de producción', 'Faltantes', 67, 'evaluable', 2, null),
    (sb, 'AB-068', 'Sin sobreproducción', 'Sobreproducción', 68, 'evaluable', 1, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Recetas y estandarización', 2, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-069', 'Se usa la receta oficial', 'Receta oficial', 69, 'evaluable', 2, null),
    (sb, 'AB-070', 'Ingredientes conforme a receta', 'Ingredientes', 70, 'evaluable', 2, null),
    (sb, 'AB-071', 'Gramajes conforme a receta', 'Gramajes', 71, 'evaluable', 2, null),
    (sb, 'AB-072', 'Cantidades conforme a receta', 'Cantidades', 72, 'evaluable', 2, null),
    (sb, 'AB-073', 'Método de preparación conforme a receta', 'Método', 73, 'evaluable', 2, null),
    (sb, 'AB-074', 'Tiempos de preparación conforme a receta', 'Tiempos', 74, 'evaluable', 1, null),
    (sb, 'AB-075', 'Temperaturas de cocción/conservación conforme a receta', 'Temperaturas', 75, 'evaluable', 3, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Rendimientos', 3, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-076', 'Rendimiento estándar del producto revisado', 'Rendimiento estándar', 76, 'dato', 0, '% o unidades'),
    (sb, 'AB-077', 'Rendimiento real obtenido', 'Rendimiento real', 77, 'dato', 0, '% o unidades'),
    (sb, 'AB-078', 'Desviación de rendimiento dentro de tolerancia', 'Desviación', 78, 'evaluable', 2, null),
    (sb, 'AB-079', 'Causa de la desviación', 'Causa', 79, 'dato', 0, 'texto'),
    (sb, 'AB-080', 'Acción correctiva de la desviación', 'Acción correctiva', 80, 'dato', 0, 'texto');
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Registros', 4, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-081', 'Registro diario de producción completo', 'Registro diario', 81, 'evaluable', 2, null),
    (sb, 'AB-082', 'Producción etiquetada', 'Etiquetado', 82, 'evaluable', 2, null),
    (sb, 'AB-083', 'Producción registrada consistente con Parrot', 'Consistencia con Parrot', 83, 'evaluable', 2, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'AB-06', 'Calidad de alimentos', 6, 2) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'General', 1, true) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-084', 'Sabor conforme a estándar', 'Sabor', 84, 'evaluable', 2, null),
    (sb, 'AB-085', 'Textura conforme a estándar', 'Textura', 85, 'evaluable', 2, null),
    (sb, 'AB-086', 'Color/cocción conforme a estándar', 'Color/cocción', 86, 'evaluable', 2, null),
    (sb, 'AB-087', 'Temperatura de servicio correcta', 'Temperatura', 87, 'medicion', 2, '°C · estándar por platillo por confirmar'),
    (sb, 'AB-088', 'Insumos utilizados en buen estado', 'Estado de insumos', 88, 'evaluable', 3, null),
    (sb, 'AB-089', 'Montaje conforme a estándar', 'Montaje', 89, 'evaluable', 1, null),
    (sb, 'AB-090', 'Porción conforme a estándar', 'Porción', 90, 'evaluable', 2, null),
    (sb, 'AB-091', 'Gramaje conforme a estándar', 'Gramaje', 91, 'evaluable', 2, null),
    (sb, 'AB-092', 'Ingredientes conforme a estándar', 'Ingredientes', 92, 'evaluable', 2, null),
    (sb, 'AB-093', 'Aderezos conforme a estándar', 'Aderezos', 93, 'evaluable', 1, null),
    (sb, 'AB-094', 'Salsas conforme a estándar', 'Salsas', 94, 'evaluable', 1, null),
    (sb, 'AB-095', 'Complementos conforme a estándar', 'Complementos', 95, 'evaluable', 1, null),
    (sb, 'AB-096', 'Prueba aleatoria de platillo contra estándar Cofki aprobada', 'Pruebas aleatorias contra estándar Cofki', 96, 'evaluable', 2, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'AB-07', 'Barra', 7, 2) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Mise en place', 1, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-097', 'Estación de barra completa', 'Estación completa', 97, 'evaluable', 2, null),
    (sb, 'AB-098', 'Insumos suficientes en barra', 'Insumos suficientes', 98, 'evaluable', 2, null),
    (sb, 'AB-099', 'Frutas en buen estado y suficientes', 'Frutas', 99, 'evaluable', 2, null),
    (sb, 'AB-100', 'Leches en buen estado, vigentes y suficientes', 'Leches', 100, 'evaluable', 3, null),
    (sb, 'AB-101', 'Jarabes suficientes y vigentes', 'Jarabes', 101, 'evaluable', 1, null),
    (sb, 'AB-102', 'Toppings suficientes y vigentes', 'Toppings', 102, 'evaluable', 1, null),
    (sb, 'AB-103', 'Complementos de barra suficientes', 'Complementos', 103, 'evaluable', 1, null),
    (sb, 'AB-104', 'Insumos de barra etiquetados', 'Etiquetado', 104, 'evaluable', 2, null),
    (sb, 'AB-105', 'Rotación PEP en barra cumplida', 'PEP', 105, 'evaluable', 2, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Recetas', 2, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-106', 'Dosificación conforme a receta', 'Dosificación', 106, 'evaluable', 2, null),
    (sb, 'AB-107', 'Gramajes de barra conforme a receta', 'Gramajes', 107, 'evaluable', 2, null),
    (sb, 'AB-108', 'Medidas conforme a receta', 'Medidas', 108, 'evaluable', 2, null),
    (sb, 'AB-109', 'Se usa la receta oficial de barra', 'Receta oficial', 109, 'evaluable', 2, null),
    (sb, 'AB-110', 'Tiempos de preparación de barra conforme a receta', 'Tiempos', 110, 'evaluable', 1, null),
    (sb, 'AB-111', 'Método de preparación de barra conforme a receta', 'Método', 111, 'evaluable', 2, null),
    (sb, 'AB-112', 'Preparación consistente entre baristas', 'Consistencia entre baristas', 112, 'evaluable', 2, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Calidad', 3, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-113', 'Sabor de bebidas conforme a estándar', 'Sabor', 113, 'evaluable', 2, null),
    (sb, 'AB-114', 'Temperatura de bebidas conforme a estándar', 'Temperatura', 114, 'medicion', 2, '°C · estándar por bebida por confirmar'),
    (sb, 'AB-115', 'Textura de bebidas conforme a estándar', 'Textura', 115, 'evaluable', 1, null),
    (sb, 'AB-116', 'Presentación de bebidas conforme a estándar', 'Presentación', 116, 'evaluable', 1, null),
    (sb, 'AB-117', 'Porción de bebidas conforme a estándar', 'Porción', 117, 'evaluable', 2, null),
    (sb, 'AB-118', 'Bebidas consistentes entre preparaciones', 'Consistencia', 118, 'evaluable', 1, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Velocidad', 4, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-119', 'Tiempo de preparación de bebidas dentro del estándar', 'Tiempo de preparación', 119, 'medicion', 2, 'minutos · estándar por confirmar'),
    (sb, 'AB-120', 'Sin pedidos atrasados en barra', 'Pedidos atrasados', 120, 'evaluable', 1, null),
    (sb, 'AB-121', 'Sin remakes en barra durante la observación', 'Remakes', 121, 'evaluable', 1, null),
    (sb, 'AB-122', 'Barra coordinada con cocina y servicio', 'Coordinación con cocina y servicio', 122, 'evaluable', 1, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'AB-08', 'Equipos y mantenimiento de barra', 8, 1) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'General', 1, true) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-123', 'Cafetera funcionando y en buen estado', 'Cafetera', 123, 'evaluable', 3, null),
    (sb, 'AB-124', 'Molino funcionando y calibrado', 'Molino', 124, 'evaluable', 2, null),
    (sb, 'AB-125', 'Licuadoras funcionando y en buen estado', 'Licuadoras', 125, 'evaluable', 2, null),
    (sb, 'AB-126', 'Refrigeradores de barra funcionando', 'Refrigeradores', 126, 'evaluable', 3, null),
    (sb, 'AB-127', 'Máquina de hielo funcionando y limpia', 'Máquina de hielo', 127, 'evaluable', 3, null),
    (sb, 'AB-128', 'Equipos de agua/filtración funcionando y con filtros vigentes', 'Equipos de agua/filtración', 128, 'evaluable', 3, null),
    (sb, 'AB-129', 'Equipos de barra limpios', 'Limpieza', 129, 'evaluable', 2, null),
    (sb, 'AB-130', 'Mantenimiento preventivo de barra al día', 'Mantenimiento preventivo', 130, 'evaluable', 2, null),
    (sb, 'AB-131', 'Descalcificación realizada según programa', 'Descalcificación', 131, 'evaluable', 2, null),
    (sb, 'AB-132', 'Contactos de barra en condiciones seguras', 'Contactos', 132, 'evaluable', 3, null),
    (sb, 'AB-133', 'Cables de barra en condiciones seguras', 'Cables', 133, 'evaluable', 3, null),
    (sb, 'AB-134', 'Sin fugas en barra', 'Fugas', 134, 'evaluable', 2, null),
    (sb, 'AB-135', 'Sin fallas recurrentes en equipos de barra', 'Fallas recurrentes', 135, 'evaluable', 2, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'AB-09', 'Inventarios A&B', 9, 1) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'General', 1, true) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-136', 'Inventario físico de cocina realizado', 'Inventario físico cocina', 136, 'evaluable', 2, null),
    (sb, 'AB-137', 'Inventario físico de barra realizado', 'Inventario físico barra', 137, 'evaluable', 2, null),
    (sb, 'AB-138', 'Inventario físico cuadra contra Parrot', 'Comparación contra Parrot', 138, 'evaluable', 3, null),
    (sb, 'AB-139', 'Sin faltantes relevantes contra Parrot', 'Faltantes', 139, 'evaluable', 2, null),
    (sb, 'AB-140', 'Sin sobreinventarios relevantes', 'Sobreinventarios', 140, 'evaluable', 1, null),
    (sb, 'AB-141', 'Productos críticos con existencia suficiente', 'Productos críticos', 141, 'evaluable', 3, null),
    (sb, 'AB-142', 'Café: existencia correcta', 'Café', 142, 'evaluable', 2, null),
    (sb, 'AB-143', 'Leches: existencia correcta', 'Leches', 143, 'evaluable', 2, null),
    (sb, 'AB-144', 'Frutas: existencia correcta', 'Frutas', 144, 'evaluable', 1, null),
    (sb, 'AB-145', 'Jarabes: existencia correcta', 'Jarabes', 145, 'evaluable', 1, null),
    (sb, 'AB-146', 'Toppings: existencia correcta', 'Toppings', 146, 'evaluable', 1, null),
    (sb, 'AB-147', 'Bebidas: existencia correcta', 'Bebidas', 147, 'evaluable', 1, null),
    (sb, 'AB-148', 'Desechables: existencia correcta', 'Desechables', 148, 'evaluable', 1, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'AB-10', 'Mermas y rendimientos', 10, 1) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'General', 1, true) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-149', 'Mermas registradas correctamente', 'Mermas registradas', 149, 'evaluable', 2, null),
    (sb, 'AB-150', 'Sin mermas no registradas', 'Mermas no registradas', 150, 'evaluable', 3, null),
    (sb, 'AB-151', 'Principales causas de merma', 'Principales causas', 151, 'dato', 0, 'texto'),
    (sb, 'AB-152', 'Merma por caducidad bajo control', 'Caducidad', 152, 'evaluable', 2, null),
    (sb, 'AB-153', 'Merma por sobreproducción bajo control', 'Sobreproducción', 153, 'evaluable', 1, null),
    (sb, 'AB-154', 'Merma por mala preparación bajo control', 'Mala preparación', 154, 'evaluable', 1, null),
    (sb, 'AB-155', 'Merma por producto dañado bajo control', 'Producto dañado', 155, 'evaluable', 1, null),
    (sb, 'AB-156', 'Remakes/errores bajo control', 'Remakes / errores', 156, 'evaluable', 1, null),
    (sb, 'AB-157', 'Consumo real consistente con ventas', 'Consumo real vs ventas', 157, 'evaluable', 3, null),
    (sb, 'AB-158', 'Uso de insumos conforme a receta', 'Uso conforme a receta', 158, 'evaluable', 2, null),
    (sb, 'AB-159', 'Desviaciones de consumo dentro de tolerancia', 'Desviaciones', 159, 'evaluable', 2, null),
    (sb, 'AB-160', 'Productos con merma elevada', 'Productos con merma elevada', 160, 'dato', 0, 'texto (lista de productos)');

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'AB-11', 'Parrot y controles', 11, 1) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'General', 1, true) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-161', 'Inventarios registrados en Parrot', 'Inventarios registrados', 161, 'evaluable', 3, null),
    (sb, 'AB-162', 'Producciones registradas en Parrot', 'Producciones registradas', 162, 'evaluable', 2, null),
    (sb, 'AB-163', 'Mermas registradas en Parrot', 'Mermas registradas', 163, 'evaluable', 2, null),
    (sb, 'AB-164', 'Sin movimientos pendientes en Parrot', 'Movimientos pendientes', 164, 'evaluable', 2, null),
    (sb, 'AB-165', 'Operación física consistente con el sistema', 'Consistencia entre operación física y sistema', 165, 'evaluable', 3, null),
    (sb, 'AB-166', 'Diferencias físico vs sistema identificadas', 'Diferencias', 166, 'dato', 0, 'texto / monto'),
    (sb, 'AB-167', 'Causas de las diferencias', 'Causas', 167, 'dato', 0, 'texto'),
    (sb, 'AB-168', 'Diferencias corregidas en el sistema', 'Corrección', 168, 'evaluable', 2, null),
    (sb, 'AB-169', 'Diferencias anteriores con seguimiento', 'Seguimiento', 169, 'evaluable', 2, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'AB-12', 'Limpieza y sanitización', 12, 2) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Cocina', 1, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-170', 'Mesas de cocina limpias y sanitizadas', 'Mesas', 170, 'evaluable', 3, null),
    (sb, 'AB-171', 'Paredes de cocina limpias', 'Paredes', 171, 'evaluable', 1, null),
    (sb, 'AB-172', 'Pisos de cocina limpios', 'Pisos', 172, 'evaluable', 2, null),
    (sb, 'AB-173', 'Repisas limpias', 'Repisas', 173, 'evaluable', 1, null),
    (sb, 'AB-174', 'Debajo/detrás de equipos limpio', 'Debajo/detrás de equipos', 174, 'evaluable', 2, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Equipos', 2, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-175', 'Equipos limpios por dentro y por fuera', 'Limpieza interior/exterior', 175, 'evaluable', 2, null),
    (sb, 'AB-176', 'Equipos de cocción limpios', 'Cocción', 176, 'evaluable', 2, null),
    (sb, 'AB-177', 'Equipos de refrigeración limpios', 'Refrigeración', 177, 'evaluable', 2, null),
    (sb, 'AB-178', 'Equipos de producción limpios', 'Producción', 178, 'evaluable', 2, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Barra', 3, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-179', 'Superficies de barra limpias y sanitizadas', 'Superficies', 179, 'evaluable', 3, null),
    (sb, 'AB-180', 'Equipos de barra limpios', 'Equipos', 180, 'evaluable', 2, null),
    (sb, 'AB-181', 'Tarjas de barra limpias', 'Tarjas', 181, 'evaluable', 2, null),
    (sb, 'AB-182', 'Refrigeración de barra limpia', 'Refrigeración', 182, 'evaluable', 2, null),
    (sb, 'AB-183', 'Área de preparación de barra limpia', 'Área de preparación', 183, 'evaluable', 2, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Lavado', 4, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-184', 'Tarjas de lavado limpias', 'Tarjas', 184, 'evaluable', 2, null),
    (sb, 'AB-185', 'Drenajes de lavado limpios y funcionando', 'Drenajes', 185, 'evaluable', 2, null),
    (sb, 'AB-186', 'Jabón disponible', 'Jabón', 186, 'evaluable', 3, null),
    (sb, 'AB-187', 'Sanitizante disponible y en concentración correcta', 'Sanitizante', 187, 'evaluable', 3, null),
    (sb, 'AB-188', 'Trapos/esponjas limpios y en buen estado', 'Trapos/esponjas', 188, 'evaluable', 2, null),
    (sb, 'AB-189', 'Procedimiento de lavado correcto', 'Procedimientos', 189, 'evaluable', 2, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'AB-13', 'Servicio y flujo A&B', 13, 1) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'General', 1, true) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-190', 'Comandas correctas', 'Comanda correcta', 190, 'evaluable', 2, null),
    (sb, 'AB-191', 'Cocina recibe la información correcta', 'Cocina recibe información correcta', 191, 'evaluable', 2, null),
    (sb, 'AB-192', 'Barra recibe la información correcta', 'Barra recibe información correcta', 192, 'evaluable', 2, null),
    (sb, 'AB-193', 'Modificaciones comunicadas correctamente', 'Modificaciones comunicadas', 193, 'evaluable', 2, null),
    (sb, 'AB-194', 'Salida de alimentos y bebidas coordinada', 'Alimentos y bebidas coordinados', 194, 'evaluable', 1, null),
    (sb, 'AB-195', 'Sin pedidos atrasados', 'Pedidos atrasados', 195, 'evaluable', 1, null),
    (sb, 'AB-196', 'Sin pedidos incorrectos', 'Pedidos incorrectos', 196, 'evaluable', 2, null),
    (sb, 'AB-197', 'Sin remakes durante la observación', 'Remakes', 197, 'evaluable', 1, null),
    (sb, 'AB-198', 'Sin devoluciones durante la observación', 'Devoluciones', 198, 'evaluable', 1, null),
    (sb, 'AB-199', 'Coordinación correcta con meseros y nannies', 'Coordinación con meseros y nannies', 199, 'evaluable', 1, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'AB-14', 'Procesos y estandarización', 14, 1) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'General', 1, true) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-200', 'Recepción de materia prima conforme a estándar', 'Recepción de materia prima', 200, 'evaluable', 2, null),
    (sb, 'AB-201', 'Almacenamiento conforme a estándar', 'Almacenamiento', 201, 'evaluable', 2, null),
    (sb, 'AB-202', 'Producción conforme a estándar', 'Producción', 202, 'evaluable', 2, null),
    (sb, 'AB-203', 'Conservación conforme a estándar', 'Conservación', 203, 'evaluable', 2, null),
    (sb, 'AB-204', 'Preparación conforme a estándar', 'Preparación', 204, 'evaluable', 2, null),
    (sb, 'AB-205', 'Montaje conforme a estándar', 'Montaje', 205, 'evaluable', 1, null),
    (sb, 'AB-206', 'Entrega conforme a estándar', 'Entrega', 206, 'evaluable', 1, null),
    (sb, 'AB-207', 'Limpieza durante la operación conforme a estándar', 'Limpieza durante operación', 207, 'evaluable', 2, null),
    (sb, 'AB-208', 'Cierre conforme a estándar', 'Cierre', 208, 'evaluable', 2, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'AB-15', 'Capacitación', 15, 1) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'General', 1, true) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'AB-209', 'Personal conoce las recetas', 'Conocimiento de recetas', 209, 'evaluable', 2, null),
    (sb, 'AB-210', 'Personal conoce los estándares', 'Estándares', 210, 'evaluable', 2, null),
    (sb, 'AB-211', 'Personal conoce las prácticas de inocuidad', 'Inocuidad', 211, 'evaluable', 3, null),
    (sb, 'AB-212', 'Personal maneja correctamente los equipos', 'Manejo de equipos', 212, 'evaluable', 2, null),
    (sb, 'AB-213', 'Personal nuevo capacitado', 'Personal nuevo', 213, 'evaluable', 2, null),
    (sb, 'AB-214', 'Necesidades de capacitación detectadas', 'Necesidades de capacitación', 214, 'dato', 0, 'texto'),
    (sb, 'AB-215', 'Sin errores recurrentes del personal', 'Errores recurrentes', 215, 'evaluable', 2, null);

  update public.template_versions set status = 'publicada', published_at = now() where id = v;
end $$;

do $$
declare v int; s int; sb int;
begin
  insert into public.template_versions(audit_type_id, version, status, notes)
  values ((select id from public.audit_types where code = 'FRONT'), 1, 'borrador', 'v1 de prueba — pendiente de aprobación')
  returning id into v;

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'FR-01', 'Personal Front', 1, 1) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'General', 1, true) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'FR-001', 'Presentación personal adecuada', 'Presentación', 1, 'evaluable', 1, null),
    (sb, 'FR-002', 'Higiene personal adecuada', 'Higiene', 2, 'evaluable', 2, null),
    (sb, 'FR-003', 'Uniforme completo, limpio y en buen estado', 'Uniforme', 3, 'evaluable', 2, null),
    (sb, 'FR-004', 'Actitud positiva y de servicio', 'Actitud', 4, 'evaluable', 2, null),
    (sb, 'FR-005', 'Trato amable al cliente y al equipo', 'Trato', 5, 'evaluable', 2, null),
    (sb, 'FR-006', 'Celular usado solo conforme a la política', 'Uso de celular', 6, 'evaluable', 1, null),
    (sb, 'FR-007', 'Personal llega y opera en su horario asignado', 'Puntualidad', 7, 'evaluable', 2, null),
    (sb, 'FR-008', 'Cada colaborador cumple sus funciones asignadas', 'Funciones', 8, 'evaluable', 1, null),
    (sb, 'FR-009', 'Personal productivo durante el turno', 'Productividad', 9, 'evaluable', 1, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'FR-02', 'Recepción y bienvenida', 2, 1) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'General', 1, true) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'FR-010', 'Tiempo de recepción dentro del estándar', 'Tiempo de recepción', 10, 'medicion', 2, 'minutos · estándar por confirmar'),
    (sb, 'FR-011', 'Saludo conforme a estándar', 'Saludo', 11, 'evaluable', 2, null),
    (sb, 'FR-012', 'Actitud en la recepción', 'Actitud', 12, 'evaluable', 1, null),
    (sb, 'FR-013', 'Asignación de mesa correcta', 'Asignación de mesa', 13, 'evaluable', 1, null),
    (sb, 'FR-014', 'Lista de espera gestionada correctamente', 'Lista de espera', 14, 'evaluable', 1, null),
    (sb, 'FR-015', 'Tiempos de espera comunicados al cliente', 'Comunicación de tiempos', 15, 'evaluable', 1, null),
    (sb, 'FR-016', 'Hostess conoce el menú', 'Conocimiento del menú', 16, 'evaluable', 1, null),
    (sb, 'FR-017', 'Se informan las promociones vigentes', 'Información de promociones', 17, 'evaluable', 1, null),
    (sb, 'FR-018', 'Se informa sobre nannies y área infantil', 'Información de nannies/área infantil', 18, 'evaluable', 2, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'FR-03', 'Servicio en mesa', 3, 2) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'General', 1, true) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'FR-019', 'Toma de orden correcta', 'Toma de orden', 19, 'evaluable', 2, null),
    (sb, 'FR-020', 'Mesero conoce el menú', 'Conocimiento del menú', 20, 'evaluable', 2, null),
    (sb, 'FR-021', 'Modificaciones registradas correctamente', 'Modificaciones', 21, 'evaluable', 2, null),
    (sb, 'FR-022', 'Se realiza venta sugestiva', 'Venta sugestiva', 22, 'evaluable', 1, null),
    (sb, 'FR-023', 'Seguimiento a la mesa durante el servicio', 'Seguimiento', 23, 'evaluable', 1, null),
    (sb, 'FR-024', 'Necesidades del cliente atendidas', 'Atención de necesidades', 24, 'evaluable', 2, null),
    (sb, 'FR-025', 'Retiro de loza oportuno', 'Retiro de loza', 25, 'evaluable', 1, null),
    (sb, 'FR-026', 'Entrega correcta a la mesa', 'Entrega correcta', 26, 'evaluable', 2, null),
    (sb, 'FR-027', 'Se verifica la satisfacción del cliente', 'Verificación de satisfacción', 27, 'evaluable', 1, null),
    (sb, 'FR-028', 'Cuenta entregada correcta y a tiempo', 'Cuenta', 28, 'evaluable', 2, null),
    (sb, 'FR-029', 'Despedida conforme a estándar', 'Despedida', 29, 'evaluable', 1, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'FR-04', 'Experiencia del cliente', 4, 2) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'General', 1, true) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'FR-030', 'Trato al cliente conforme a estándar', 'Trato', 30, 'evaluable', 2, null),
    (sb, 'FR-031', 'Ambiente adecuado (música, temperatura, iluminación)', 'Ambiente', 31, 'evaluable', 1, null),
    (sb, 'FR-032', 'Comodidad del cliente', 'Comodidad', 32, 'evaluable', 1, null),
    (sb, 'FR-033', 'Limpieza visible para el cliente', 'Limpieza visible', 33, 'evaluable', 2, null),
    (sb, 'FR-034', 'Necesidades especiales atendidas (alergias, accesibilidad, bebés)', 'Necesidades especiales', 34, 'evaluable', 2, null),
    (sb, 'FR-035', 'Quejas registradas', 'Quejas', 35, 'evaluable', 2, null),
    (sb, 'FR-036', 'Quejas resueltas', 'Resolución', 36, 'evaluable', 2, null),
    (sb, 'FR-037', 'Quejas con seguimiento', 'Seguimiento', 37, 'evaluable', 1, null),
    (sb, 'FR-038', 'Observación directa / cliente incógnito sin hallazgos', 'Cliente incógnito / observación directa', 38, 'evaluable', 2, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'FR-05', 'Caja', 5, 3) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Apertura', 1, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'FR-039', 'Fondo de caja correcto', 'Fondo', 39, 'evaluable', 3, null),
    (sb, 'FR-040', 'Responsable de caja asignado', 'Responsable', 40, 'evaluable', 2, null),
    (sb, 'FR-041', 'Accesos a caja controlados', 'Accesos', 41, 'evaluable', 3, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Cobros', 2, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'FR-042', 'Cobros en efectivo correctos', 'Efectivo', 42, 'evaluable', 3, null),
    (sb, 'FR-043', 'Cobros con tarjeta correctos', 'Tarjetas', 43, 'evaluable', 3, null),
    (sb, 'FR-044', 'Terminales funcionando y conciliadas', 'Terminales', 44, 'evaluable', 2, null),
    (sb, 'FR-045', 'Cobros correctos contra consumo', 'Cobros correctos', 45, 'evaluable', 3, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Excepciones', 3, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'FR-046', 'Descuentos autorizados y registrados', 'Descuentos', 46, 'evaluable', 3, null),
    (sb, 'FR-047', 'Cortesías autorizadas y registradas', 'Cortesías', 47, 'evaluable', 3, null),
    (sb, 'FR-048', 'Cancelaciones autorizadas y registradas', 'Cancelaciones', 48, 'evaluable', 3, null),
    (sb, 'FR-049', 'Devoluciones autorizadas y registradas', 'Devoluciones', 49, 'evaluable', 3, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Propinas', 4, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'FR-050', 'Propinas registradas correctamente', 'Registro', 50, 'evaluable', 2, null),
    (sb, 'FR-051', 'Proceso de propinas conforme a estándar', 'Proceso', 51, 'evaluable', 2, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Cierre', 5, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'FR-052', 'Corte de caja realizado correctamente', 'Corte', 52, 'evaluable', 3, null),
    (sb, 'FR-053', 'Efectivo cuadra contra sistema', 'Efectivo vs sistema', 53, 'evaluable', 3, null),
    (sb, 'FR-054', 'Terminales cuadran contra sistema', 'Terminales vs sistema', 54, 'evaluable', 3, null),
    (sb, 'FR-055', 'Diferencia de caja', 'Diferencias', 55, 'medicion', 3, '$ MXN · estándar: $0'),
    (sb, 'FR-056', 'Evidencia del corte conservada', 'Evidencia', 56, 'evaluable', 2, null),
    (sb, 'FR-057', 'Diferencias anteriores con seguimiento', 'Seguimiento', 57, 'evaluable', 2, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'FR-06', 'Reservaciones, eventos y Playdates', 6, 1) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'General', 1, true) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'FR-058', 'Reservaciones/eventos registrados', 'Registro', 58, 'evaluable', 2, null),
    (sb, 'FR-059', 'Reservaciones confirmadas', 'Confirmación', 59, 'evaluable', 1, null),
    (sb, 'FR-060', 'Mesas asignadas para reservaciones', 'Mesas', 60, 'evaluable', 1, null),
    (sb, 'FR-061', 'Información del evento completa', 'Información', 61, 'evaluable', 2, null),
    (sb, 'FR-062', 'Comunicación del evento al equipo', 'Comunicación', 62, 'evaluable', 2, null),
    (sb, 'FR-063', 'Montaje del evento conforme a lo acordado', 'Montaje', 63, 'evaluable', 2, null),
    (sb, 'FR-064', 'Cocina informada y preparada para el evento', 'Cocina', 64, 'evaluable', 1, null),
    (sb, 'FR-065', 'Barra informada y preparada para el evento', 'Barra', 65, 'evaluable', 1, null),
    (sb, 'FR-066', 'Nannies informadas y preparadas para el evento', 'Nannies', 66, 'evaluable', 2, null),
    (sb, 'FR-067', 'Cobro del evento correcto', 'Cobro', 67, 'evaluable', 2, null),
    (sb, 'FR-068', 'No-shows registrados y gestionados', 'No-shows', 68, 'evaluable', 1, null),
    (sb, 'FR-069', 'Cambios gestionados y comunicados', 'Cambios', 69, 'evaluable', 1, null),
    (sb, 'FR-070', 'Cancelaciones gestionadas y comunicadas', 'Cancelaciones', 70, 'evaluable', 1, null),
    (sb, 'FR-071', 'Incidencias del evento registradas y atendidas', 'Incidencias', 71, 'evaluable', 2, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'FR-07', 'Nannies', 7, 3) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'General', 1, true) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'FR-072', 'Presentación de nannies adecuada', 'Presentación', 72, 'evaluable', 1, null),
    (sb, 'FR-073', 'Nannies puntuales', 'Puntualidad', 73, 'evaluable', 2, null),
    (sb, 'FR-074', 'Cobertura de nannies suficiente para los niños presentes', 'Cobertura', 74, 'evaluable', 3, null),
    (sb, 'FR-075', 'Actitud de nannies adecuada', 'Actitud', 75, 'evaluable', 2, null),
    (sb, 'FR-076', 'Nannies capacitadas', 'Capacitación', 76, 'evaluable', 2, null),
    (sb, 'FR-077', 'Recepción de niños conforme a protocolo', 'Recepción de niños', 77, 'evaluable', 3, null),
    (sb, 'FR-078', 'Control de niños dentro del área', 'Control', 78, 'evaluable', 3, null),
    (sb, 'FR-079', 'Identificación de padres/responsables al entregar', 'Identificación de padres/responsables', 79, 'evaluable', 3, null),
    (sb, 'FR-080', 'Supervisión constante de los niños', 'Supervisión', 80, 'evaluable', 3, null),
    (sb, 'FR-081', 'Capacidad del área respetada', 'Capacidad', 81, 'evaluable', 3, null),
    (sb, 'FR-082', 'Reglas del área aplicadas', 'Reglas', 82, 'evaluable', 2, null),
    (sb, 'FR-083', 'Actividades programadas realizadas', 'Actividades', 83, 'evaluable', 1, null),
    (sb, 'FR-084', 'Materiales de actividades suficientes y en buen estado', 'Materiales', 84, 'evaluable', 1, null),
    (sb, 'FR-085', 'Comunicación correcta con padres', 'Comunicación con padres', 85, 'evaluable', 2, null),
    (sb, 'FR-086', 'Incidentes registrados y atendidos', 'Incidentes', 86, 'evaluable', 3, null),
    (sb, 'FR-087', 'Escalamiento de incidentes conforme a protocolo', 'Escalamiento', 87, 'evaluable', 3, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'FR-08', 'Área infantil', 8, 3) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'General', 1, true) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'FR-088', 'Área infantil limpia', 'Limpieza', 88, 'evaluable', 2, null),
    (sb, 'FR-089', 'Juegos limpios y en buen estado', 'Juegos', 89, 'evaluable', 2, null),
    (sb, 'FR-090', 'Mesas del área infantil en buen estado', 'Mesas', 90, 'evaluable', 1, null),
    (sb, 'FR-091', 'Sillas del área infantil en buen estado', 'Sillas', 91, 'evaluable', 1, null),
    (sb, 'FR-092', 'Tapetes en buen estado', 'Tapetes', 92, 'evaluable', 2, null),
    (sb, 'FR-093', 'Materiales en buen estado', 'Materiales', 93, 'evaluable', 1, null),
    (sb, 'FR-094', 'Área infantil ordenada', 'Orden', 94, 'evaluable', 1, null),
    (sb, 'FR-095', 'Sin piezas sueltas', 'Piezas sueltas', 95, 'evaluable', 3, null),
    (sb, 'FR-096', 'Sin bordes peligrosos', 'Bordes peligrosos', 96, 'evaluable', 3, null),
    (sb, 'FR-097', 'Puertas del área funcionando y seguras', 'Puertas', 97, 'evaluable', 3, null),
    (sb, 'FR-098', 'Barreras en buen estado', 'Barreras', 98, 'evaluable', 3, null),
    (sb, 'FR-099', 'Capacidad del área respetada', 'Capacidad', 99, 'evaluable', 3, null),
    (sb, 'FR-100', 'Iluminación del área infantil adecuada', 'Iluminación', 100, 'evaluable', 1, null),
    (sb, 'FR-101', 'Clima del área infantil adecuado', 'Clima', 101, 'evaluable', 1, null),
    (sb, 'FR-102', 'Ventilación adecuada', 'Ventilación', 102, 'evaluable', 1, null),
    (sb, 'FR-103', 'Contactos protegidos', 'Contactos', 103, 'evaluable', 3, null),
    (sb, 'FR-104', 'Sin riesgos visibles en el área infantil', 'Riesgos', 104, 'evaluable', 3, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'FR-09', 'Limpieza Front', 9, 2) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'General', 1, true) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'FR-105', 'Salón limpio', 'Salón', 105, 'evaluable', 2, null),
    (sb, 'FR-106', 'Mesas limpias', 'Mesas', 106, 'evaluable', 2, null),
    (sb, 'FR-107', 'Sillas limpias', 'Sillas', 107, 'evaluable', 1, null),
    (sb, 'FR-108', 'Bancas limpias', 'Bancas', 108, 'evaluable', 1, null),
    (sb, 'FR-109', 'Sillones limpios', 'Sillones', 109, 'evaluable', 1, null),
    (sb, 'FR-110', 'Pisos limpios', 'Pisos', 110, 'evaluable', 2, null),
    (sb, 'FR-111', 'Paredes limpias', 'Paredes', 111, 'evaluable', 1, null),
    (sb, 'FR-112', 'Ventanas limpias', 'Ventanas', 112, 'evaluable', 1, null),
    (sb, 'FR-113', 'Puertas limpias', 'Puertas', 113, 'evaluable', 1, null),
    (sb, 'FR-114', 'Decoración limpia', 'Decoración', 114, 'evaluable', 1, null),
    (sb, 'FR-115', 'Estaciones de servicio limpias', 'Estaciones', 115, 'evaluable', 2, null),
    (sb, 'FR-116', 'Baños limpios y abastecidos', 'Baños', 116, 'evaluable', 3, null),
    (sb, 'FR-117', 'Área infantil limpia', 'Área infantil', 117, 'evaluable', 2, null),
    (sb, 'FR-118', 'Exterior limpio', 'Exterior', 118, 'evaluable', 1, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'FR-10', 'Mantenimiento Front', 10, 1) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Salón', 1, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'FR-119', 'Mobiliario del salón en buen estado', 'Mobiliario', 119, 'evaluable', 1, null),
    (sb, 'FR-120', 'Pisos del salón en buen estado', 'Pisos', 120, 'evaluable', 1, null),
    (sb, 'FR-121', 'Paredes del salón en buen estado', 'Paredes', 121, 'evaluable', 1, null),
    (sb, 'FR-122', 'Techos/plafones en buen estado', 'Techos/plafones', 122, 'evaluable', 1, null),
    (sb, 'FR-123', 'Pintura en buen estado', 'Pintura', 123, 'evaluable', 1, null),
    (sb, 'FR-124', 'Puertas del salón funcionando', 'Puertas', 124, 'evaluable', 1, null),
    (sb, 'FR-125', 'Ventanas en buen estado', 'Ventanas', 125, 'evaluable', 1, null),
    (sb, 'FR-126', 'Cristales sin daños', 'Cristales', 126, 'evaluable', 2, null),
    (sb, 'FR-127', 'Espejos en buen estado', 'Espejos', 127, 'evaluable', 1, null),
    (sb, 'FR-128', 'Iluminación del salón funcionando', 'Iluminación', 128, 'evaluable', 1, null),
    (sb, 'FR-129', 'Contactos del salón en buen estado y seguros', 'Contactos', 129, 'evaluable', 2, null),
    (sb, 'FR-130', 'Clima del salón funcionando', 'Clima', 130, 'evaluable', 2, null),
    (sb, 'FR-131', 'Sin humedad ni filtraciones en salón', 'Humedad/filtraciones', 131, 'evaluable', 2, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Baños', 2, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'FR-132', 'Sanitarios funcionando', 'Sanitarios', 132, 'evaluable', 2, null),
    (sb, 'FR-133', 'Lavabos funcionando', 'Lavabos', 133, 'evaluable', 2, null),
    (sb, 'FR-134', 'Llaves funcionando', 'Llaves', 134, 'evaluable', 1, null),
    (sb, 'FR-135', 'Desagües funcionando', 'Desagües', 135, 'evaluable', 2, null),
    (sb, 'FR-136', 'Puertas de baños funcionando', 'Puertas', 136, 'evaluable', 1, null),
    (sb, 'FR-137', 'Iluminación de baños funcionando', 'Iluminación', 137, 'evaluable', 1, null),
    (sb, 'FR-138', 'Ventilación de baños funcionando', 'Ventilación', 138, 'evaluable', 1, null),
    (sb, 'FR-139', 'Sin fugas en baños', 'Fugas', 139, 'evaluable', 2, null),
    (sb, 'FR-140', 'Sin humedad en baños', 'Humedad', 140, 'evaluable', 1, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Área infantil', 3, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'FR-141', 'Juegos del área infantil en buen estado', 'Juegos', 141, 'evaluable', 3, null),
    (sb, 'FR-142', 'Estructuras firmes y seguras', 'Estructuras', 142, 'evaluable', 3, null),
    (sb, 'FR-143', 'Resbaladillas en buen estado', 'Resbaladillas', 143, 'evaluable', 3, null),
    (sb, 'FR-144', 'Tapetes del área infantil en buen estado', 'Tapetes', 144, 'evaluable', 2, null),
    (sb, 'FR-145', 'Protecciones completas y en buen estado', 'Protecciones', 145, 'evaluable', 3, null),
    (sb, 'FR-146', 'Tornillería completa y apretada', 'Tornillos', 146, 'evaluable', 3, null),
    (sb, 'FR-147', 'Sin piezas sueltas en juegos', 'Piezas sueltas', 147, 'evaluable', 3, null),
    (sb, 'FR-148', 'Bordes protegidos', 'Bordes', 148, 'evaluable', 3, null),
    (sb, 'FR-149', 'Puertas/barreras del área infantil funcionando', 'Puertas/barreras', 149, 'evaluable', 3, null),
    (sb, 'FR-150', 'Clima del área infantil funcionando', 'Clima', 150, 'evaluable', 1, null),
    (sb, 'FR-151', 'Contactos del área infantil protegidos', 'Contactos', 151, 'evaluable', 3, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Exterior', 4, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'FR-152', 'Fachada en buen estado', 'Fachada', 152, 'evaluable', 1, null),
    (sb, 'FR-153', 'Letreros en buen estado e iluminados', 'Letreros', 153, 'evaluable', 1, null),
    (sb, 'FR-154', 'Iluminación exterior funcionando', 'Iluminación', 154, 'evaluable', 1, null),
    (sb, 'FR-155', 'Accesos en buen estado', 'Accesos', 155, 'evaluable', 2, null),
    (sb, 'FR-156', 'Banquetas en buen estado', 'Banquetas', 156, 'evaluable', 1, null),
    (sb, 'FR-157', 'Jardinería en buen estado', 'Jardinería', 157, 'evaluable', 1, null),
    (sb, 'FR-158', 'Terraza en buen estado', 'Terraza', 158, 'evaluable', 1, null),
    (sb, 'FR-159', 'Mobiliario exterior en buen estado', 'Mobiliario', 159, 'evaluable', 1, null),
    (sb, 'FR-160', 'Cámaras/control de acceso exterior funcionando', 'Cámaras/control de acceso', 160, 'evaluable', 2, null);
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'Equipos Front', 5, false) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'FR-161', 'Terminales funcionando', 'Terminales', 161, 'evaluable', 2, null),
    (sb, 'FR-162', 'Computadoras/tablets funcionando', 'Computadoras/tablets', 162, 'evaluable', 2, null),
    (sb, 'FR-163', 'Impresoras funcionando', 'Impresoras', 163, 'evaluable', 2, null),
    (sb, 'FR-164', 'Pantallas funcionando', 'Pantallas', 164, 'evaluable', 1, null),
    (sb, 'FR-165', 'Bocinas funcionando', 'Bocinas', 165, 'evaluable', 1, null),
    (sb, 'FR-166', 'Teléfonos funcionando', 'Teléfonos', 166, 'evaluable', 1, null),
    (sb, 'FR-167', 'Wi-Fi funcionando', 'Wi-Fi', 167, 'evaluable', 1, null),
    (sb, 'FR-168', 'Cámaras funcionando', 'Cámaras', 168, 'evaluable', 2, null),
    (sb, 'FR-169', 'Música funcionando', 'Música', 169, 'evaluable', 1, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'FR-11', 'Seguridad', 11, 3) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'General', 1, true) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'FR-170', 'Extintores vigentes, accesibles y señalizados', 'Extintores', 170, 'evaluable', 3, null),
    (sb, 'FR-171', 'Rutas de evacuación señalizadas y libres', 'Rutas de evacuación', 171, 'evaluable', 3, null),
    (sb, 'FR-172', 'Salidas de emergencia libres y funcionando', 'Salidas de emergencia', 172, 'evaluable', 3, null),
    (sb, 'FR-173', 'Iluminación de emergencia funcionando', 'Iluminación de emergencia', 173, 'evaluable', 2, null),
    (sb, 'FR-174', 'Botiquín completo y vigente', 'Botiquín', 174, 'evaluable', 2, null),
    (sb, 'FR-175', 'Cámaras de seguridad funcionando y grabando', 'Cámaras', 175, 'evaluable', 2, null),
    (sb, 'FR-176', 'Puertas de seguridad funcionando', 'Puertas', 176, 'evaluable', 2, null),
    (sb, 'FR-177', 'Sin riesgos visibles en la sucursal', 'Riesgos visibles', 177, 'evaluable', 3, null),
    (sb, 'FR-178', 'Seguridad infantil garantizada', 'Seguridad infantil', 178, 'evaluable', 3, null),
    (sb, 'FR-179', 'Capacidad del área infantil respetada', 'Capacidad del área infantil', 179, 'evaluable', 3, null),
    (sb, 'FR-180', 'Incidentes de seguridad registrados y atendidos', 'Incidentes', 180, 'evaluable', 3, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'FR-12', 'Coordinación Front ↔ A&B', 12, 1) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'General', 1, true) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'FR-181', 'Comandas correctas hacia cocina y barra', 'Comandas', 181, 'evaluable', 2, null),
    (sb, 'FR-182', 'Modificaciones comunicadas a cocina y barra', 'Modificaciones', 182, 'evaluable', 2, null),
    (sb, 'FR-183', 'Tiempos de salida dentro del estándar', 'Tiempos', 183, 'evaluable', 1, null),
    (sb, 'FR-184', 'Salida de platillos y bebidas coordinada', 'Coordinación de salida', 184, 'evaluable', 1, null),
    (sb, 'FR-185', 'Sin pedidos atrasados', 'Pedidos atrasados', 185, 'evaluable', 1, null),
    (sb, 'FR-186', 'Sin errores en pedidos', 'Errores', 186, 'evaluable', 2, null),
    (sb, 'FR-187', 'Sin remakes durante la observación', 'Remakes', 187, 'evaluable', 1, null),
    (sb, 'FR-188', 'Sin devoluciones durante la observación', 'Devoluciones', 188, 'evaluable', 1, null),
    (sb, 'FR-189', 'Comunicación Front ↔ A&B efectiva', 'Comunicación', 189, 'evaluable', 1, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'FR-13', 'Ventas y productividad', 13, 1) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'General', 1, true) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'FR-190', 'Ventas del periodo', 'Ventas', 190, 'dato', 0, '$ MXN'),
    (sb, 'FR-191', 'Ticket promedio', 'Ticket promedio', 191, 'dato', 0, '$ MXN'),
    (sb, 'FR-192', 'Mix alimentos/bebidas', 'Mix alimentos/bebidas', 192, 'dato', 0, '% alimentos / % bebidas'),
    (sb, 'FR-193', 'Ocupación', 'Ocupación', 193, 'dato', 0, '%'),
    (sb, 'FR-194', 'Rotación de mesas', 'Rotación', 194, 'dato', 0, 'veces por turno'),
    (sb, 'FR-195', 'Venta sugestiva aplicada por el equipo', 'Venta sugestiva', 195, 'evaluable', 1, null),
    (sb, 'FR-196', 'Se ofrecen productos adicionales', 'Productos adicionales', 196, 'evaluable', 1, null),
    (sb, 'FR-197', 'Horas pico identificadas', 'Horas pico', 197, 'dato', 0, 'texto'),
    (sb, 'FR-198', 'Oportunidades de venta detectadas', 'Oportunidades', 198, 'dato', 0, 'texto');

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'FR-14', 'Procesos y estándares', 14, 1) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'General', 1, true) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'FR-199', 'Llegada del cliente conforme a estándar', 'Llegada', 199, 'evaluable', 1, null),
    (sb, 'FR-200', 'Recepción conforme a estándar', 'Recepción', 200, 'evaluable', 1, null),
    (sb, 'FR-201', 'Asignación de mesa conforme a estándar', 'Mesa', 201, 'evaluable', 1, null),
    (sb, 'FR-202', 'Toma de orden conforme a estándar', 'Orden', 202, 'evaluable', 1, null),
    (sb, 'FR-203', 'Preparación conforme a tiempos estándar', 'Preparación', 203, 'evaluable', 1, null),
    (sb, 'FR-204', 'Entrega conforme a estándar', 'Entrega', 204, 'evaluable', 1, null),
    (sb, 'FR-205', 'Seguimiento conforme a estándar', 'Seguimiento', 205, 'evaluable', 1, null),
    (sb, 'FR-206', 'Cobro conforme a estándar', 'Cobro', 206, 'evaluable', 2, null),
    (sb, 'FR-207', 'Despedida conforme a estándar', 'Despedida', 207, 'evaluable', 1, null);

  insert into public.audit_sections(template_version_id, code, name, sort, weight) values (v, 'FR-15', 'Capacitación', 15, 1) returning id into s;
  insert into public.audit_subsections(section_id, name, sort, is_default) values (s, 'General', 1, true) returning id into sb;
  insert into public.audit_items(subsection_id, code, text, original_text, sort, item_type, weight, unit) values
    (sb, 'FR-208', 'Personal conoce el menú', 'Menú', 208, 'evaluable', 2, null),
    (sb, 'FR-209', 'Personal conoce el estándar de servicio', 'Servicio', 209, 'evaluable', 2, null),
    (sb, 'FR-210', 'Personal capacitado en caja', 'Caja', 210, 'evaluable', 2, null),
    (sb, 'FR-211', 'Personal capacitado en reservaciones', 'Reservaciones', 211, 'evaluable', 1, null),
    (sb, 'FR-212', 'Nannies capacitadas en protocolo', 'Nannies', 212, 'evaluable', 2, null),
    (sb, 'FR-213', 'Personal capacitado en seguridad infantil', 'Seguridad infantil', 213, 'evaluable', 3, null),
    (sb, 'FR-214', 'Personal capacitado en manejo de quejas', 'Quejas', 214, 'evaluable', 2, null),
    (sb, 'FR-215', 'Personal capacitado en sistemas (Parrot, terminales)', 'Sistemas', 215, 'evaluable', 2, null),
    (sb, 'FR-216', 'Personal nuevo capacitado', 'Personal nuevo', 216, 'evaluable', 2, null),
    (sb, 'FR-217', 'Sin errores recurrentes del personal', 'Errores recurrentes', 217, 'evaluable', 2, null);

  update public.template_versions set status = 'publicada', published_at = now() where id = v;
end $$;

