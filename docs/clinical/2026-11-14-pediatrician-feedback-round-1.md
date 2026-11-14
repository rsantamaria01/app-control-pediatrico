# Retroalimentación de la pediatra — ronda 1 (2026-11-14)

Fuente: mensajes de WhatsApp de la pediatra a Raul, reenviados el 2026-11-14. Texto literal.
Contexto: revisó una demo interactiva con datos ficticios y maquetas generadas aparte.

## Texto literal

### Pantalla principal de padres

Aquí hay algo que me hace ruido. Que la pantalla de padres solo se presente así máximo.

yo quitaría todo lo de los puntajes Z y los checks verdes. Siento que ponerles a los papás toda esa información puede generarles más ansiedad que otra cosa, porque no necesariamente saben cómo interpretarla.

Yo pondría simplemente un resumen del último control con el peso, talla y perímetro cefálico, las recomendaciones que les dejé y cuándo les toca regresar.

Los gráficos de crecimiento sí podemos tenerlos en otra sección, pero no quisiera que la pantalla principal les esté diciendo si algo está normal o alterado. Prefiero que esa interpretación la haga yo durante la consulta.

### Inicio del médico

Arriba pondría «Hoy», con las citas del día, cuántas están por confirmar y cuáles ya atendí. En cada paciente quisiera ver de una vez nombre, edad y último peso, porque en pediatría son datos que usamos todo el tiempo. Y que tocando el nombre pueda entrar directamente a su ficha.

Abajo pondría «Mis pacientes», pero más resumido. Ahí tendría tres cosas: vacunación por revisar, crecimiento por revisar y controles pendientes.

Lo de crecimiento que ahora está separado entre valores fuera de 2 DE y cambios en las curvas, yo lo uniría. Que al entrar podamos ver ambos, pero sin tener todas esas listas desplegadas en el inicio.

Y en vacunación quisiera poder identificar a los niños que tienen vacunas pendientes, tanto del MSP como las complementarias, para poder contactar a sus familias.

La idea es que el inicio sea bastante compacto y que me muestre qué tengo que atender, sin llenarlo de información que puedo revisar entrando a cada sección.

### Lista de pacientes

Primero pondría el botón de Nuevo paciente arriba, junto al título, no abajo.

Después dejaría el buscador y el listado en orden alfabético, pero mucho más compacto. En cada paciente quiero ver principalmente nombre, edad y último peso, porque son los datos que más utilizo en pediatría.

Quitaría de aquí los diagnósticos y puntajes Z. Eso prefiero verlo dentro de la ficha. Si hay algo de crecimiento o vacunas pendiente, podemos dejar una indicación pequeña, sin que ocupe tanto espacio.

También quisiera que el buscador encuentre pacientes por nombre, apellido o cédula, y que tocando cualquier parte de la fila entre directamente a su ficha.

La idea es que esta pantalla sirva para encontrar pacientes rápido, no para revisar todos sus resultados clínicos.

### Nuevo paciente

Yo dejaría primero los datos del niño: nombres, apellidos, fecha de nacimiento, sexo, cédula y número de historia clínica del Hospital Santamaría.

La cédula sería el identificador principal para evitar pacientes duplicados. Si ya existe esa cédula, que el sistema me avise y me permita abrir la ficha que ya está creada. Y si todavía no tengo el número, que me deje registrarlo y completarlo después.

También quisiera agregar el número de historia clínica del hospital, pero opcional, porque muchos de mis pacientes ya tienen una. Por ahora no tenemos conectados ambos sistemas, así que lo ingresaríamos manualmente. El sistema puede generar su propio identificador interno, pero eso no necesito verlo ni llenarlo yo.

Después pondría los datos del representante: nombre completo, parentesco, teléfono/WhatsApp y correo electrónico. También dejaría la opción de agregar otro representante.

Algo importante es que un mismo padre puede tener varios hijos, así que no debería necesitar una cuenta diferente para cada niño. Si ya está registrado, deberíamos poder vincular al nuevo paciente con ese representante, verificando que sea la persona correcta.

Y sí quiero conservar la opción que ya pusiste de «Invitar al portal de padres», porque justamente esa es la manera de conectar mi sistema con lo que ve la familia.

La idea es que al crear al paciente se le envíe un enlace al correo del representante para activar su acceso. Por ahora los padres solamente podrán visualizar la información que yo decida compartir, no modificar los datos clínicos.

Si no pongo correo, que me permita crear al paciente sin enviar la invitación y hacerlo después.

También es importante que crear al paciente y enviar la invitación sean dos procesos independientes. Si falla el correo, la ficha debe quedar guardada y yo debería poder reenviar la invitación. Sería bueno poder ver si está sin invitar, pendiente de activación o si ya tiene acceso.

Y quitaría de esta pantalla todos los antecedentes al nacimiento: edad gestacional, peso, longitud, perímetro cefálico y notas perinatales. Eso prefiero completarlo después dentro de la ficha del paciente.

La idea es que Nuevo paciente sea un registro rápido, no una historia clínica completa. Que al guardarlo me abra directamente su ficha para continuar trabajando.

### En resumen (de la pediatra)

* Datos del niño: nombres, apellidos, fecha de nacimiento, sexo, cédula e historia clínica HSM (opcional, ingreso manual).
* Duplicados: validar por cédula. Si ya existe, abrir la ficha. Si no tiene cédula disponible, permitir registro provisional y revisar coincidencias. Generar ID interno automático.
* Representantes: nombre, parentesco, WhatsApp y correo. Permitir agregar varios representantes y vincular varios hijos a una misma cuenta, sin duplicarla.
* Portal de padres: mantener la opción de invitar por correo, con enlace seguro de activación. Acceso solo de lectura a la información autorizada.
* Invitaciones: permitir enviarlas después, reenviarlas y consultar su estado (sin invitar, pendiente, activo). Si falla el correo, no perder el registro del paciente.
* Eliminar del formulario: edad gestacional, medidas al nacimiento y antecedentes perinatales. Todo eso irá dentro de la ficha.
* Al guardar: abrir directamente la ficha del paciente.

La idea es que el registro sea rápido y que la información clínica se complete después.

## Maquetas que aprobó (descritas, no adjuntas)

1. Padres, tarjeta del hijo: nombre y edad; "Último control" con fecha; tres casillas Peso / Talla / Cabeza; bloque "Indicaciones de tu pediatra" con la última indicación y enlace "Ver todas las indicaciones"; "Próximo control" con día, fecha y hora. Sin Z, sin checks, sin etiquetas.
2. Inicio del médico: saludo con fecha; bloque "Hoy" con tres contadores (Citas, Por confirmar, Atendido) y enlace "Ver agenda completa"; "Próximas citas" con hora, nombre, edad · último peso, motivo y una etiqueta pequeña (p. ej. "Vacunas"); bloque "Mis pacientes" con tres filas con contador: Vacunación por revisar, Crecimiento por revisar, Controles pendientes. Navegación inferior: Inicio, Pacientes, Agenda, Ajustes.
3. Pacientes: título con botón "+ Nuevo" a la derecha; buscador "Buscar por nombre o identificación"; selector de orden A–Z; filas con iniciales, nombre completo, "edad · último peso" y como máximo una indicación pequeña ("Vacunas por revisar" / "Crecimiento por revisar"); chevron; toda la fila navega a la ficha.
4. Nuevo paciente: "Datos del paciente" (Nombres*, Apellidos*, Fecha de nacimiento*, Sexo registrado al nacer* Femenino/Masculino, Cédula / NUI, Historia clínica HSM (opcional)); "Contacto familiar" (Nombre completo*, Parentesco*, Teléfono / WhatsApp* con prefijo +593, Correo electrónico, "Agregar otro representante"); "Acceso familiar" con interruptor "Invitar al portal de padres" y la nota "Para enviar la invitación se requiere un correo electrónico válido."; botón "Crear paciente".
