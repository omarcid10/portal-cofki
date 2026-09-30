# Cofki · Reporte de Calificaciones

Aplicación web (HTML + CSS + JS puro, sin backend) para capturar semanalmente las calificaciones de las marcas de Cofki en las apps de delivery, comparar contra la semana anterior y generar un reporte visual listo para compartir por WhatsApp.

## Cómo abrirla

1. Descarga los 3 archivos (`index.html`, `styles.css`, `app.js`) en la **misma carpeta**.
2. Haz doble clic en `index.html` (se abre en tu navegador). No necesita instalación, servidor ni internet, salvo la primera carga de las fuentes y las librerías de exportación (Google Fonts, html2canvas y jsPDF, cargadas por CDN).
3. Los datos se guardan automáticamente en tu navegador (`localStorage`), así que sobreviven a cerrar y volver a abrir. Si cambias de navegador o de computadora, usa **Exportar / Importar datos** para llevarte la información.

La app ya incluye datos de ejemplo (Uber Eats, sucursales GM3 y Aurora con dos semanas, y Pueblo Serena con el catálogo de marcas pero sin historial) para que puedas probar todo de inmediato.

## Flujo semanal recomendado

1. Ve a **Captura semanal**.
2. Elige la aplicación (Uber Eats / DiDi Food / Rappi), la fecha de la semana y la sucursal.
3. Aparece la tabla con todas las marcas activas de esa sucursal, mostrando también la calificación de la semana anterior como referencia. Escribe la calificación de cada marca (usa **Enter** para saltar al siguiente campo).
4. Presiona **Guardar semana**. Si dejas una marca en blanco, esa marca queda como "N/D" esa semana (no se inventa ni afecta promedios).
5. Repite para cada sucursal y, si aplica, cada aplicación.
6. Ve a **Generar reporte**, elige aplicación y semana (y opcionalmente una sola sucursal), y presiona **Generar reporte**.
7. La app calcula automáticamente las flechas de tendencia (verde = subió, roja = bajó, gris = sin cambio, "Nueva" cuando no hay semana previa) y las diferencias numéricas.
8. Usa **Descargar PNG** para compartir por WhatsApp (alta resolución), **Descargar PDF** para archivar, o **Copiar reporte** para pegarlo directamente donde lo necesites.

## Secciones

- **Dashboard**: promedio general, comparación contra la semana anterior, cuántas marcas subieron/bajaron/se mantuvieron, y mejor/peor desempeño. Filtrable por aplicación, sucursal y semana.
- **Captura semanal**: alta rápida de calificaciones, con validación de rango (0.0–5.0).
- **Generar reporte**: reporte visual ejecutivo por aplicación (todas las sucursales) o por una sola sucursal.
- **Historial**: lista de semanas registradas (haz clic en una para ver cómo se veía el reporte esa semana) y una gráfica de evolución por marca/sucursal/aplicación.
- **Configuración**: administra Aplicaciones, Sucursales y Marcas (agregar, renombrar, activar/desactivar, reordenar, eliminar) y las Preferencias (decimales, respaldo). Nada de esto requiere tocar el código.

## Notas importantes

- **Eliminar vs. desactivar**: eliminar una aplicación, sucursal o marca también elimina su historial de calificaciones asociado (se pide confirmación). Si solo quieres dejar de capturarla pero conservar el historial, usa **Desactivar** en su lugar.
- **Sucursales nuevas** (como Pueblo Serena): mientras no tengan una semana anterior, el reporte muestra "Nueva" en vez de inventar una variación.
- **Marcas sin captura esa semana**: se muestran como "N/D" y no se incluyen en los promedios ni conteos del dashboard.
- **Orden del reporte**: en Configuración → Marcas puedes usar las flechas ▲▼ para decidir el orden en que aparecen las marcas en la captura y en el reporte.

## Arquitectura (para el futuro)

El código está organizado en capas independientes dentro de `app.js`:

- `Store`: toda la persistencia (hoy `localStorage`). Cada método regresa una `Promise`, así que para migrar a una base de datos como **Supabase** solo hay que reescribir esta capa (por ejemplo, cambiar `localStorage.getItem/setItem` por llamadas a la API de Supabase) sin tocar el resto de la aplicación.
- `Calc`: toda la lógica de negocio pura (`obtenerSemanaAnterior`, `calcularVariacion`, `determinarTendencia`, `calcularPromedio`, `calcularCrecimiento`, `obtenerMejorDesempeno`, `obtenerPeorDesempeno`). No toca el DOM ni el storage, así que es fácil de probar y de reutilizar si más adelante se agrega backend.
- `Views.*`: un módulo por sección (Dashboard, Captura, Reporte, Historial, Configuración).
- `ReportBuilder` / `Export`: arman el HTML del reporte y lo convierten a PNG/PDF (con `html2canvas` y `jsPDF`) o lo copian al portapapeles.

El modelo de datos usa cuatro catálogos (`apps`, `branches`, `brands`, `weeks`) y una tabla de hechos (`ratings`) con llaves `appId/branchId/brandId/weekId`, exactamente el esquema que necesitaría una tabla en una base de datos relacional — pensado para que, cuando quieran una versión multiusuario, la migración a Supabase sea sobre todo cambiar la capa `Store`.

## Respaldo

- **Exportar datos** (JSON): respaldo completo (catálogos + historial). Úsalo para restaurar todo en otra computadora con **Importar datos**.
- **Exportar historial (CSV)**: una fila por calificación capturada, para abrir en Excel/Sheets.
- **Restaurar datos de demostración** (en Configuración → Preferencias): regresa la app al estado inicial de ejemplo — borra tus datos reales, úsalo con cuidado.
