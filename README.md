# Portal Cofki — acceso por nivel

Portal centralizado para las apps internas de Cofki Café, con 3 niveles de acceso por contraseña:

- **socios** — tú y tu socio, ven todo
- **gerentes** — ven apps de gerentes + equipo
- **equipo** — solo ven apps marcadas como "equipo"

Cada nivel tiene su propia contraseña, y **tú puedes cambiarlas cuando quieras** desde `/admin.html` (solo visible si entraste con la contraseña de socios) — sin tocar código ni volver a desplegar.

## Cómo funciona la seguridad (leer antes de usar)

- Las contraseñas se guardan **hasheadas** (no en texto plano) en Netlify Blobs, un almacén persistente ligado a tu sitio.
- Al entrar, el servidor te da una cookie firmada (HttpOnly, no accesible desde JavaScript) que dice tu rol.
- La lista de apps que ves **se filtra en el servidor**, no en el navegador — alguien con el nivel "equipo" nunca recibe las URLs de las apps de "socios", ni buscando en el código de la página.
- Esto es un nivel de seguridad razonable para uso interno de equipo (evita que cualquiera con el link del portal vea todo). **No es lo mismo que proteger cada app individualmente**: si alguien ya tiene el link directo de una app (ej. la de inventario), ese link sigue abierto por su cuenta, a menos que también le pongas su propia protección. Si quieres, en otro momento puedo ayudarte a ponerle una contraseña a cada app por separado también.

## Desplegar en Netlify

1. **Sube esta carpeta a un repositorio de GitHub** (Netlify despliega mejor desde Git que por drag-and-drop cuando hay funciones):
   ```bash
   cd lcg-portal
   git init
   git add .
   git commit -m "Portal Cofki inicial"
   git remote add origin <tu-repo-nuevo-en-github>
   git push -u origin main
   ```

2. **En Netlify**: "Add new site" → "Import an existing project" → conecta el repo. Netlify detecta `netlify.toml` automáticamente (build command vacío, publish = `public`, functions = `netlify/functions`).

3. **Variables de entorno** (Site settings → Environment variables), agrega:
   | Variable | Valor |
   |---|---|
   | `SESSION_SECRET` | Una cadena larga y aleatoria (ej. genera una con `openssl rand -hex 32`) |
   | `DEFAULT_PW_SOCIOS` | Contraseña inicial para socios (opcional, si no la pones usa una por defecto) |
   | `DEFAULT_PW_GERENTES` | Contraseña inicial para gerentes |
   | `DEFAULT_PW_EQUIPO` | Contraseña inicial para equipo |

   **`SESSION_SECRET` es obligatoria** — sin ella el login no funciona.

4. **Deploy**. Netlify instala `@netlify/blobs` automáticamente (está en `package.json`).

5. Entra a tu sitio, inicia sesión con la contraseña de socios, ve a **Administrar contraseñas** y cámbialas de inmediato por las definitivas.

## Agregar o quitar apps

Edita `netlify/functions/lib/apps.js` — es un arreglo simple:

```js
{
  id: 'nombre-unico',
  name: 'Nombre que se muestra',
  description: 'Una línea de descripción',
  url: 'https://tu-app.netlify.app',
  minTier: 'equipo', // 'socios' | 'gerentes' | 'equipo'
}
```

Ya están cargadas 5: Inventarios Diarios, Administración de Reservas, Llegadas Hostess - Pueblo Serena, Entrevistas y Auditorías Operativas. Después de editar, haz commit + push y Netlify vuelve a desplegar solo.

## Sobre el diseño

El portal usa la identidad oficial de Cofki (colores Candy, Jungle, Honey, Butter y tipografía Montserrat / Montserrat Alternates, según el Manual de Identidad). El logo vive en `public/assets/` — si lo actualizas, reemplaza esos archivos con el mismo nombre y vuelve a hacer push.

## Cambiar contraseñas más adelante

Ve a `/admin.html` estando logueado como socios. No necesitas tocar código ni redeploy — el cambio es inmediato para todos.

## Si alguien sale del equipo

Cambia la contraseña del nivel correspondiente desde `/admin.html`. Esa persona (y cualquiera con esa contraseña vieja) pierde el acceso al instante; nadie más se ve afectado.
