Voy a arreglarlo en una pasada, pero como ahora estoy en modo de planificación solo puedo inspeccionar y proponer los cambios. Ya revisé logs, funciones backend, reglas de acceso y migraciones recientes.

Diagnóstico preliminar

1. El problema más fuerte viene del último endurecimiento de seguridad:
   - Se revocó el permiso de ejecución de las funciones internas `gcal_encrypt` y `gcal_decrypt` para usuarios normales, lo cual está bien para el cliente.
   - Pero las funciones backend de Google Calendar las llaman mediante RPC desde un cliente de servicio. Aunque el rol de servicio sí tiene permiso, esto debe dejarse blindado y probado explícitamente para evitar fallos de sincronización por permisos o por valores nulos de tokens cifrados.

2. También encontré un fallo real en base de datos que puede romper flujos generales:
   - No existe ningún trigger activo en la base de datos.
   - El trigger `on_auth_user_created`, que crea automáticamente el perfil al registrar un usuario, desapareció/no está instalado.
   - Consecuencia: nuevos usuarios pueden iniciar sesión pero quedarse sin fila en `profiles`, lo que rompe partes de grupos, eventos, sidebar o joins dependiendo del flujo.

3. Hay una vulnerabilidad que además puede causar comportamiento inconsistente:
   - La política de `user_groups` permite que cualquier usuario se agregue a un grupo con cualquier `role`, incluyendo `admin`.
   - Esto no solo es inseguro, también puede ensuciar la lógica de “grupos que administro / grupos a los que pertenezco”.

4. Hay varias escrituras directas desde frontend a `google_calendar_tokens.last_synced_at`.
   - Después del endurecimiento, la tabla ya no tiene política UPDATE para usuarios autenticados.
   - Por eso esas escrituras fallan silenciosamente o generan errores. El backend ya actualiza `last_synced_at`, así que esas escrituras del frontend sobran y deben eliminarse.

5. Hay un warning de CSS que no parece ser la causa principal, pero conviene corregirlo:
   - `@import` de Google Fonts está después de `@tailwind`, y Vite advierte que `@import` debe ir antes. Esto puede afectar estilos/compilación en algunos entornos.

Plan de arreglo

1. Restaurar infraestructura crítica de autenticación
   - Crear una migración que reinstale de forma idempotente:
     - `public.handle_new_user()`
     - trigger `on_auth_user_created` sobre nuevos usuarios
     - triggers `updated_at` donde correspondan, sin tocar esquemas reservados más allá del trigger de auth ya existente en el diseño original.
   - Agregar reparación de datos: crear perfiles faltantes para usuarios existentes que no tengan `profiles`.

2. Corregir reglas de grupos y roles
   - Reemplazar la política insegura de auto-join en `user_groups`.
   - Permitir auto-unión solo como `member`.
   - Mantener que el creador de un grupo quede como `admin`, pero hacerlo mediante backend/trigger seguro o política separada controlada.
   - Ajustar el flujo de creación de grupo para no depender de una inserción insegura desde frontend con `role: "admin"`.

3. Arreglar Google Calendar después del hardening
   - Eliminar las actualizaciones directas desde frontend a `google_calendar_tokens.last_synced_at` en:
     - `GoogleCalendarConnect.tsx`
     - `EventPage.tsx`
     - `ScheduleUpload.tsx`
   - Dejar que solo la función backend `google-calendar-events` actualice `last_synced_at`.
   - Añadir validaciones defensivas en backend para:
     - token cifrado ausente
     - error explícito de `gcal_decrypt`
     - error explícito de `gcal_encrypt`
     - error de update del token renovado
   - Mantener que tokens nunca vuelvan al frontend ni a logs.

4. Corregir el frontend que puede quedarse “roto” o silencioso
   - En `AuthContext`, escuchar eventos de sesión y redirigir de forma más estable tras login/signup si hace falta.
   - En páginas principales, no ignorar errores críticos de base de datos; mostrar mensajes útiles cuando un usuario no tiene permisos o falta perfil.
   - En `EventPage`, evitar doble auto-sync simultáneo en carga + cambio de semana, porque puede insertar/actualizar la misma participación en carrera.

5. Corregir CSS warning
   - Mover el `@import` de Google Fonts al inicio de `src/index.css`, antes de `@tailwind`.

6. Verificación
   - Ejecutar linter/scan después de los cambios.
   - Probar con consultas que existan triggers y políticas correctas.
   - Revisar logs de funciones de Google Calendar.
   - Validar flujos principales:
     - registro/login
     - crear grupo
     - crear evento
     - unirse a grupo/evento
     - conectar/desconectar Google Calendar
     - sincronizar semana

Qué causó que dejara de funcionar

La causa más probable fue una combinación del último endurecimiento de seguridad con reglas incompletas:

- Se movió Google Calendar al backend y se bloquearon escrituras directas del cliente, pero todavía quedaron partes del frontend intentando actualizar `google_calendar_tokens`. Eso empezó a fallar porque la tabla ya no permite UPDATE desde el cliente.
- El trigger de creación automática de perfil no existe actualmente en la base de datos. Eso rompe usuarios nuevos o flujos que esperan que `profiles` ya esté creado.
- La política de roles de grupos quedó insegura y demasiado permisiva, generando estados inconsistentes.

Qué haré para que no vuelva a pasar

- Separar claramente: el frontend solo lee estado mínimo; el backend maneja tokens y sincronización.
- Hacer migraciones idempotentes para triggers/políticas críticas.
- Añadir validaciones explícitas y mensajes seguros en funciones backend.
- Eliminar escrituras cliente que ya no tienen permiso por seguridad.
- Re-ejecutar scan/linter y dejar la app sin warnings críticos conocidos.

Sobre tus créditos

No puedo ver ni modificar tu facturación o recargas desde el código del proyecto. Lo que sí puedo aclarar:

- El modo Plan consume 1 crédito por mensaje.
- En modo Build, los créditos se consumen según la complejidad y cantidad de trabajo/cambios.
- Los créditos diarios/mensuales dependen de tu plan y del ciclo de facturación. En plan gratuito hay créditos diarios, pero con límite mensual.
- Si no se recargaron durante 2 semanas, eso apunta a un tema de cuenta/plan/ciclo de facturación, no a este código.

Para revisarlo: abre el nombre de tu workspace/proyecto arriba a la izquierda y mira la barra de créditos, o ve a Settings → Plans & Credits. Si ahí no aparecen recargas esperadas, tendrás que contactar soporte de Lovable porque yo no tengo acceso administrativo a tu cuenta ni puedo emitir créditos.

Cuando apruebes, implementaré estos cambios.