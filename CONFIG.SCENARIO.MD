# ===== GUÍA DE CONFIGURACIÓN PARA DIFERENTES ESCENARIOS =====


# 🎯 CONFIGURACIONES RECOMENDADAS POR ESCENARIO:

1. **PRECISIÓN ALTA, NO TAN ESTRICTO (RECOMENDADO PARA TI):**
   FACE_CONFIDENCE_THRESHOLD=0.42
   FACE_DETECTION_CONFIDENCE=0.65
   REGISTER_CONFIDENCE=0.75
   RECOGNIZE_CONFIDENCE=0.42
   FACE_MIN_SIZE=60
   FACE_INPUT_SIZE_TINY=416

2. **ALTA SEGURIDAD (BANCOS, GOBIERNO):**
   FACE_CONFIDENCE_THRESHOLD=0.25
   FACE_DETECTION_CONFIDENCE=0.85
   REGISTER_CONFIDENCE=0.8
   RECOGNIZE_CONFIDENCE=0.25
   REQUIRE_LANDMARKS=true

3. **VELOCIDAD MÁXIMA:**
   FACE_CONFIDENCE_THRESHOLD=0.55
   FACE_DETECTION_CONFIDENCE=0.6
   FACE_INPUT_SIZE_TINY=320
   REQUIRE_LANDMARKS=false

4. **MUY PERMISIVO:**
   FACE_CONFIDENCE_THRESHOLD=0.65
   FACE_DETECTION_CONFIDENCE=0.5
   FACE_MIN_SIZE=40

📊 EXPLICACIÓN DE PARÁMETROS:

- **CONFIDENCE_THRESHOLD (0.42)**: Qué tan similar debe ser un rostro para considerarlo match
  * 0.2-0.3 = Muy estricto (alta seguridad)
  * 0.4-0.5 = Balanceado (recomendado)
  * 0.6+ = Permisivo (riesgo de falsos positivos)

- **DETECTION_CONFIDENCE (0.65)**: Qué tan seguro debe estar de que detectó un rostro
  * 0.5-0.6 = Permisivo (detecta rostros borrosos)
  * 0.65-0.75 = Balanceado (recomendado)
  * 0.8+ = Estricto (solo rostros muy claros)

- **INPUT_SIZE (416)**: Resolución de procesamiento
  * 320 = Más rápido, menos preciso
  * 416 = Balanceado (recomendado)
  * 512 = Más lento, más preciso

🔧 AJUSTES EN TIEMPO REAL:

curl -X PUT http://localhost:4300/api/face-config/config \
  -H "Content-Type: application/json" \
  -d '{
    "confidenceThreshold": 0.45,
    "detectionConfidence": 0.7,
    "minFaceSize": 70
  }'

