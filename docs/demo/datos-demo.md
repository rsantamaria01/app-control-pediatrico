# Datos ficticios de demostración

Este comando se ejecuta exclusivamente en una base aislada de vista previa, nunca en producción. Requiere el conjunto oficial OMS verificado previamente importado. No modifica las tablas OMS ni cuentas reales. Rechaza bases con pacientes ajenos al conjunto ficticio conocido; repetirlo no duplica registros ni cambia las contraseñas ya creadas.

Desde el contenedor de aplicación del preview, con `DATABASE_URL` apuntando a una base descartable `pediatrico_design_<12 hex>_test` distinta de la base estable:

```sh
DEMO_SEED_CONFIRM=preview node scripts/ops.mjs demo-seed
```

Para la base estable de vista previa `pediatrico_design_000000000000_test`, se requiere además `DEMO_SEED_DB=pediatrico_design_000000000000_test`, idéntico al nombre conectado en `DATABASE_URL`. No se aceptan otros nombres estables ni bases de producción. En la vista previa actual las cuentas ya existen: repetir el comando no cambia ni muestra sus contraseñas.

```sh
DEMO_SEED_CONFIRM=preview DEMO_SEED_DB=pediatrico_design_000000000000_test node scripts/ops.mjs demo-seed
```

Para reiniciar solo los registros identificados como demo nuevo (se preservan los pacientes ficticios anteriores del preview):

```sh
DEMO_SEED_CONFIRM=preview node scripts/ops.mjs demo-seed --reset
```

Si Docker Compose facilita las variables de conexión (`DB_PASSWORD`, `DB_HOST`, `DB_NAME`), ejecutar en el servicio de aplicación:

```sh
docker compose exec -e DEMO_SEED_CONFIRM=preview -e DEMO_SEED_DB=pediatrico_design_000000000000_test app node scripts/ops.mjs demo-seed
```

La primera ejecución crea ocho pacientes con nombres inequívocamente ficticios y visitas con resultados calculados a partir de referencias OMS verificadas; añade cuentas `doctor`, `asistente`, `familiar` y `familiar2`, vinculaciones familiares de varios estados, visitas compartidas y privadas, observaciones, registros ficticios de vacunas/desarrollo/controles, agenda, solicitudes de reserva y avisos internos. Los registros de vacunas y desarrollo son demostrativos, no recomendaciones clínicas ni catálogos oficiales. La clínica de demostración solo se configura si no existe una configuración previa. Las contraseñas aleatorias de cuentas nuevas aparecen una sola vez en la salida del comando: conservarlas en un canal privado; una repetición no las revela ni restablece.
