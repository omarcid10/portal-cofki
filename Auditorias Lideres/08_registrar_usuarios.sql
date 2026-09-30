-- =====================================================================
-- Cofki Auditorías · 08 · Registrar a los 4 usuarios en la app
-- ANTES: crea los 4 usuarios en Authentication → Users → "Add user"
--        (correo + contraseña, con "Auto Confirm User" activado).
-- LUEGO: reemplaza los correos y nombres de abajo y ejecuta este script.
-- =====================================================================

insert into public.users (id, full_name, email, role_code, audit_type_id)
select u.id, x.nombre, u.email, x.rol,
       (select id from public.audit_types where code = x.tipo)
from (values
  ('lider.ab@cofkicafe.com',    'Nombre Líder A&B',    'lider_ab',    'AB'),
  ('lider.front@cofkicafe.com', 'Nombre Líder Front',  'lider_front', 'FRONT'),
  ('socio1@cofkicafe.com',      'Nombre Socio 1',      'socio',       null),
  ('socio2@cofkicafe.com',      'Nombre Socio 2',      'socio',       null)
) as x(correo, nombre, rol, tipo)
join auth.users u on lower(u.email) = lower(x.correo)
on conflict (id) do update
  set full_name = excluded.full_name, role_code = excluded.role_code,
      audit_type_id = excluded.audit_type_id, active = true;

-- Verificación: deben aparecer 4 filas.
select full_name, email, role_code from public.users order by role_code;
