# Fuentes de datos y requisitos — app de control pediátrico

Source: the pediatrician who requested the app, sent to Raul on 2026-11-10 16:24 (WhatsApp). Kept verbatim as clinical input; reconcile against `docs/decisions/2026-11-10-ui-and-clinical.md`.

---

Objetivo: Proporcionar al equipo de desarrollo las fuentes oficiales, archivos de referencia, parámetros clínicos y reglas necesarias para implementar el seguimiento del crecimiento, neurodesarrollo, vacunación y controles pediátricos.

La aplicación debe utilizar datos oficiales de OMS, CDC, AAP y MSP de Ecuador. Las referencias deben almacenarse con su fuente y versión para permitir futuras actualizaciones.

1. CRECIMIENTO Y ANTROPOMETRÍA — OMS

1.1. Estándares de crecimiento de 0 a 5 años (OMS 2006)

Fuente oficial:

https://www.who.int/tools/child-growth-standards/standards

Archivos y referencias para descargar:

* Peso para la edad (WFA).
* Longitud/talla para la edad (LFA/HFA).
* Peso para la longitud (WFL).
* Peso para la talla (WFH).
* IMC para la edad (BFA).
* Perímetro cefálico para la edad (HCFA).

Se deben importar los datos correspondientes a ambos sexos, incluidos los parámetros LMS, cuando estén disponibles.

Estos permiten calcular las puntuaciones Z y percentiles.

1.2. Referencias de crecimiento de 5 a 19 años (OMS 2007)

Fuente oficial:

https://www.who.int/tools/growth-reference-data-for-5to19-years/indicators

Importar:

* Talla para la edad: 5–19 años.
* IMC para la edad: 5–19 años.
* Peso para la edad: 5–10 años.

La OMS no dispone de referencias de peso/edad para todo el intervalo de 10 a 19 años.

1.3. Archivos numéricos y herramientas de cálculo

Archivos OMS disponibles desde CDC:

https://www.cdc.gov/growthcharts/who-data-files.htm

Software OMS:

https://www.who.int/tools/child-growth-standards/software

Paquete R Anthro:

https://cran.r-project.org/package=anthro

Herramientas AnthroPlus para 5–19 años:

https://www.who.int/tools/growth-reference-data-for-5to19-years/application-tools

Los desarrolladores deben utilizar los parámetros numéricos originales y validar los resultados con herramientas oficiales.

Fórmula LMS:

Z = [(X/M)^L − 1] / (L × S)

Cuando L = 0:

Z = ln(X/M) / S

La implementación debe contemplar las reglas especiales de la OMS para puntuaciones Z extremas.

2. PREMATUROS — CURVAS FENTON

Fuente:

https://fentongrowth.ca/

Se debe incorporar una referencia específica para el crecimiento de prematuros, previa validación de la versión seleccionada y sus condiciones de uso.

Datos necesarios:

* Edad gestacional al nacimiento en semanas y días.
* Edad cronológica.
* Edad corregida.
* Edad posmenstrual.
* Peso.
* Longitud.
* Perímetro cefálico.

Reglas:

* Calcular automáticamente la edad corregida.
* Utilizarla habitualmente hasta los 24 meses de edad cronológica.
* Permitir prolongar su uso hasta los 36 meses según criterio médico.
* Registrar qué referencia y qué edad se utilizaron para cada cálculo.
* Definir expresamente la transición entre las curvas para prematuros y las curvas OMS.

3. CLASIFICACIÓN ANTROPOMÉTRICA

La clasificación debe depender del indicador, la edad y los puntos de corte de la OMS.

3.1. Talla para la edad

* Z < −3: talla baja severa.
* Z < −2: talla baja.
* Z > +2: talla alta para la edad.

La denominación antropométrica OMS para talla baja es retraso del crecimiento (stunting).

3.2. Peso para la edad

* Z < −3: bajo peso severo.
* Z < −2: bajo peso.

No diagnosticar sobrepeso ni obesidad utilizando únicamente peso/edad.

Cuando Z > +2, mostrar al médico: “Revisar peso/talla o IMC/edad”.

3.3. Peso/longitud, peso/talla e IMC/edad en menores de 5 años

* Z < −3: emaciación severa.
* Z < −2: emaciación.
* Z > +1: posible riesgo de sobrepeso.
* Z > +2: sobrepeso.
* Z > +3: obesidad.

Las categorías deben ser mutuamente excluyentes, aplicando siempre la clasificación de mayor severidad correspondiente.

3.4. IMC para la edad de 5 a 19 años

* Z < −3: delgadez severa.
* Z < −2: delgadez.
* Z > +1: sobrepeso.
* Z > +2: obesidad.

3.5. Perímetro cefálico

* Z < −3: microcefalia severa.
* Z < −2: microcefalia.
* Z > +2: macrocefalia.

Estas categorías son descriptivas y requieren interpretación clínica.

3.6. Visualización

Para la médica:

* Curvas de crecimiento.
* Percentiles.
* Puntuaciones Z.
* Clasificación antropométrica.
* Evolución longitudinal.
* Alertas clínicas según indicador.

Para las familias:

* Curvas de crecimiento.
* Percentiles y puntuaciones Z.
* Evolución de las mediciones.

No mostrar automáticamente frases como “riesgo”, “vigilar” o “fuera de rango”.

No emitir diagnósticos automáticos dirigidos a las familias.

4. NEURODESARROLLO

4.1. Seis hitos motores OMS

Documento con ventanas de adquisición:

https://cdn.who.int/media/docs/default-source/child-growth/child-growth-standards/indicators/motor-development-milestones/mm_windows_table.pdf

Datos para incorporar:

1. Sentarse sin apoyo: 3,8–9,2 meses.
2. Pararse con ayuda: 4,8–11,4 meses.
3. Gatear en cuatro puntos: 5,2–13,5 meses.
4. Caminar con ayuda: 6,0–13,7 meses.
5. Pararse solo: 6,9–16,9 meses.
6. Caminar solo: 8,2–17,6 meses.

Las ventanas corresponden a variaciones normales de adquisición y no deben convertirse automáticamente en diagnósticos de retraso.

El gateo no es un requisito obligatorio para caminar.

4.2. Hitos del desarrollo CDC

Fuente oficial:

https://www.cdc.gov/act-early/resources/milestones-checklist-by-age.html

Página principal:

https://www.cdc.gov/act-early/

Incorporar hitos por edad en los siguientes dominios:

* Motricidad gruesa.
* Motricidad fina.
* Lenguaje y comunicación.
* Desarrollo cognitivo.
* Desarrollo social y emocional.

Cada hito debe permitir registrar:

* Alcanzado.
* No alcanzado.
* No evaluado.
* Edad de adquisición.
* Observaciones médicas.

Las listas de hitos no sustituyen las pruebas estandarizadas de tamizaje.

4.3. Tamizajes del desarrollo

Programar recordatorios para:

* Desarrollo general: 9, 18 y 30 meses.
* Trastorno del espectro autista: 18 y 24 meses.

Estos recordatorios no equivalen a una prueba aplicada. Debe registrarse el instrumento utilizado y su resultado.

5. VACUNACIÓN — MSP ECUADOR

Fuente oficial:

https://www.salud.gob.ec/esquema-nacional-de-vacunacion-ecuador/

El equipo debe descargar el esquema nacional vigente y el manual de inmunizaciones correspondiente.

Datos que deben estructurarse para cada vacuna:

* Nombre del biológico.
* Enfermedades que previene.
* Edad mínima.
* Edad recomendada.
* Número de dosis.
* Intervalo mínimo entre dosis.
* Refuerzos.
* Edad máxima cuando corresponda.
* Vía de administración.
* Indicaciones especiales.
* Contraindicaciones.
* Esquemas de recuperación.
* Fecha de vigencia.

Funcionalidades:

* Registrar vacunas administradas.
* Calcular próximas dosis.
* Identificar vacunas pendientes.
* Registrar vacunas privadas.
* Registrar vacunas administradas en otras instituciones.
* Incorporar esquemas especiales y de recuperación.
* Actualizar el calendario sin perder el historial.

Importante: las reglas de recuperación y los intervalos mínimos deben extraerse y validarse del documento oficial. No deben inferirse únicamente de la imagen del calendario.

6. CONTROLES DEL NIÑO SANO — AAP

Calendario Bright Futures:

https://downloads.aap.org/AAP/PDF/periodicity_schedule.pdf

Fuente AAP:

https://publications.aap.org/pediatriccare/pages/periodicity-schedule

Edades programadas:

* Recién nacido.
* 3–5 días.
* 1 mes.
* 2 meses.
* 4 meses.
* 6 meses.
* 9 meses.
* 12 meses.
* 15 meses.
* 18 meses.
* 24 meses.
* 30 meses.
* 3 años.
* 4 años.
* 5 años.
* Anualmente desde los 6 hasta los 21 años.

La aplicación debe:

* Calcular automáticamente el próximo control.
* Identificar controles pendientes.
* Identificar controles atrasados.
* Permitir controles extraordinarios.
* Modificar la frecuencia según indicación médica.
* Evitar alertas de controles ya realizados.

En prematuros y pacientes con enfermedades crónicas debe permitirse un calendario individualizado.

7. RESERVAS Y CONFIRMACIÓN DE CITAS

Las familias nuevas que soliciten citas desde la web deben quedar inicialmente en estado “Pendiente de aprobación”.

La médica y el personal administrativo autorizado podrán confirmar o rechazar las solicitudes.

No confirmar automáticamente las reservas de familias nuevas.

El sistema debe evitar duplicidad de horarios y notificar el estado de la solicitud.

8. INFORMES PDF PARA FAMILIAS

El informe puede contener:

* Identificación del paciente.
* Fecha del control.
* Mediciones antropométricas.
* Curvas de crecimiento.
* Percentiles y puntuaciones Z.
* Resultados clínicos autorizados.
* Recomendaciones médicas.
* Indicaciones de tratamiento.
* Vacunas y próximos controles.

No incluir:

* Notas médicas privadas.
* Diagnósticos diferenciales internos.
* Observaciones administrativas confidenciales.
* Información no autorizada.

La médica debe poder previsualizar y aprobar el contenido del informe.

9. ESTRUCTURA DE LA BASE DE DATOS

Colecciones sugeridas:

patients

* patient_id
* name
* birth_date
* sex
* gestational_age_days
* birth_weight
* birth_length
* birth_head_circumference

growth_measurements

* measurement_id
* patient_id
* measurement_date
* weight_kg
* length_height_cm
* measurement_position
* head_circumference_cm
* chronological_age_days
* corrected_age_days
* reference_used

growth_references

* reference_id
* source
* version
* sex
* indicator
* age_or_length
* L
* M
* S

growth_results

* measurement_id
* indicator
* z_score
* percentile
* classification
* reference_version

development_milestones

* milestone_id
* age
* domain
* description
* source
* version

development_assessments

* patient_id
* milestone_id
* assessment_date
* status
* acquisition_age
* clinical_notes

vaccination_schedule

* vaccine_id
* vaccine_name
* dose_number
* recommended_age
* minimum_age
* minimum_interval
* special_conditions
* schedule_version

vaccination_records

* patient_id
* vaccine_id
* administration_date
* dose
* manufacturer
* batch
* administration_site
* administration_route

well_child_schedule

* control_id
* recommended_age
* screenings
* schedule_version

clinical_notes

* patient_id
* author_id
* note_date
* content
* visibility

family_reports

* report_id
* patient_id
* report_date
* approved_content
* approved_by

10. VALIDACIÓN ANTES DE PRODUCCIÓN

Antes de utilizar la aplicación con pacientes reales, el equipo debe:

1. Importar las tablas antropométricas originales de la OMS.
2. Validar los cálculos de puntuaciones Z con Anthro y AnthroPlus.
3. Verificar las clasificaciones según edad e indicador.
4. Comprobar los cálculos de edad corregida.
5. Validar las reglas de vacunación contra el manual oficial del MSP.
6. Comprobar el calendario de controles y tamizajes.
7. Validar los permisos de acceso a notas clínicas.
8. Confirmar que los PDF familiares nunca incorporen notas privadas.
9. Conservar la fuente, versión y fecha de actualización de cada conjunto de datos.
10. Revisar las condiciones de licencia y reutilización de OMS, CDC, AAP y Fenton.

Principio general: la aplicación puede calcular puntuaciones Z, identificar desviaciones antropométricas y generar recordatorios, pero la interpretación clínica y los diagnósticos definitivos corresponden a la médica.

Los enlaces proporcionados son fuentes de referencia para obtener los archivos originales. No todos son enlaces de descarga directa ni ofrecen API. El equipo deberá descargar y estructurar los datos según el formato disponible, y verificar la vigencia de cada documento antes de incorporarlo.
