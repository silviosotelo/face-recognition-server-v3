face-recognition-backend-v2/
├── src/
│   ├── config/
│   │   ├── database.js
│   │   ├── face-recognition.js
│   │   └── server.js
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── recognition.controller.js
│   │   └── user.controller.js
│   ├── middleware/
│   │   ├── validation.middleware.js
│   │   ├── error.middleware.js
│   │   └── rate-limit.middleware.js
│   ├── models/
│   │   ├── User.js
│   │   └── Recognition.js
│   ├── services/
│   │   ├── face-recognition.service.js
│   │   ├── image-processing.service.js
│   │   └── cache.service.js
│   ├── utils/
│   │   ├── logger.js
│   │   ├── helpers.js
│   │   └── validators.js
│   └── routes/
│       ├── auth.routes.js
│       ├── recognition.routes.js
│       └── user.routes.js
├── public/
│   ├── models/
│   └── uploads/
├── tests/
├── package.json
└── app.js