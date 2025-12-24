# SHIBC Coding Guidelines

> **Version:** 1.0.0
> **Stand:** 2025-12-23
> **Gilt für:** Alle CTO Sub-Agents und MCP Worker

---

## 1. TypeScript Standards

### Strict Mode (Mandatory)

Alle Projekte MÜSSEN TypeScript strict mode verwenden:

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true
  }
}
```

### Type Safety Rules

1. **Keine `any` Types** - Verwende `unknown` und Type Guards
2. **Explizite Return Types** für Public Functions
3. **Readonly Arrays/Objects** wo möglich
4. **Discriminated Unions** statt Optional Properties

```typescript
// SCHLECHT
function process(data: any): any { ... }

// GUT
function process(data: unknown): ProcessResult {
  if (!isValidData(data)) throw new ValidationError();
  return transformData(data);
}
```

---

## 2. ESLint & Prettier

### ESLint Configuration

```javascript
// eslint.config.js
export default [
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
    }
  }
];
```

### Prettier Configuration

```json
// .prettierrc
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100,
  "arrowParens": "always"
}
```

---

## 3. File & Folder Naming

### Conventions

| Type | Convention | Beispiel |
|------|------------|----------|
| Files (TypeScript) | kebab-case | `user-service.ts` |
| Files (React Components) | PascalCase | `UserProfile.tsx` |
| Folders | kebab-case | `user-management/` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_RETRY_COUNT` |
| Classes | PascalCase | `UserRepository` |
| Functions/Variables | camelCase | `getUserById` |
| Types/Interfaces | PascalCase | `UserProfile` |

### Project Structure

```
src/
├── lib/              # Shared utilities & core logic
│   ├── db/           # Database access
│   ├── cache/        # Redis/caching
│   └── utils/        # Helper functions
├── services/         # Business logic layer
├── api/              # API routes/handlers
│   └── routes/       # Route definitions
├── types/            # Shared type definitions
├── config/           # Configuration loaders
└── __tests__/        # Test files (mirror src structure)
```

---

## 4. Git Commit Format

### Conventional Commits (Mandatory)

Format: `type(scope): description`

### Types

| Type | Verwendung |
|------|------------|
| `feat` | Neue Features |
| `fix` | Bug Fixes |
| `docs` | Dokumentation |
| `style` | Formatting, keine Code-Änderung |
| `refactor` | Code-Refactoring ohne Feature/Fix |
| `test` | Tests hinzufügen/ändern |
| `chore` | Build, Dependencies, Config |
| `perf` | Performance-Verbesserungen |
| `ci` | CI/CD Änderungen |
| `security` | Security Fixes/Improvements |

### Beispiele

```bash
feat(api): add user authentication endpoint
fix(auth): resolve JWT token expiration issue
docs(readme): update installation instructions
refactor(db): extract query builder to separate module
test(user-service): add edge case tests for email validation
chore(deps): update vitest to 2.1.0
security(auth): implement rate limiting on login endpoint
```

### Breaking Changes

```bash
feat(api)!: change response format for /users endpoint

BREAKING CHANGE: Response now returns paginated results instead of array
```

---

## 5. Testing Standards

### Coverage Requirements

| Metric | Minimum | Target |
|--------|---------|--------|
| Lines | 70% | 85% |
| Branches | 60% | 80% |
| Functions | 75% | 90% |
| Statements | 70% | 85% |

### Test File Location

```
src/
├── services/
│   └── user-service.ts
└── __tests__/
    └── services/
        └── user-service.test.ts
```

### Test Naming

```typescript
describe('UserService', () => {
  describe('createUser', () => {
    it('should create user with valid data', async () => { ... });
    it('should throw ValidationError for invalid email', async () => { ... });
    it('should handle database connection failure gracefully', async () => { ... });
  });
});
```

### Testing Framework

- **Unit Tests:** Vitest
- **E2E Tests:** Playwright
- **Integration Tests:** Vitest + Test Containers

### Test Patterns

```typescript
// Arrange-Act-Assert Pattern
it('should return user by id', async () => {
  // Arrange
  const mockUser = createMockUser({ id: '123' });
  mockDb.users.findById.mockResolvedValue(mockUser);

  // Act
  const result = await userService.getById('123');

  // Assert
  expect(result).toEqual(mockUser);
  expect(mockDb.users.findById).toHaveBeenCalledWith('123');
});
```

---

## 6. Documentation Requirements

### Code Comments

1. **JSDoc für Public APIs**
2. **Inline Comments** nur für komplexe Logik
3. **TODO Comments** mit Ticket-Referenz

```typescript
/**
 * Creates a new user account with email verification.
 *
 * @param data - User registration data
 * @returns Created user with pending email verification status
 * @throws {ValidationError} If email is already registered
 * @throws {DatabaseError} If database operation fails
 */
async function createUser(data: CreateUserInput): Promise<User> {
  // Complex hashing algorithm - see SHIBC-123 for details
  const hashedPassword = await hashWithPepper(data.password);

  // TODO(SHIBC-456): Add rate limiting for registration
  return db.users.create({ ...data, password: hashedPassword });
}
```

### README Requirements

Jedes Projekt MUSS enthalten:
- [ ] Installation Instructions
- [ ] Environment Variables
- [ ] Development Setup
- [ ] Build Commands
- [ ] Test Commands
- [ ] Deployment Instructions

---

## 7. Security Best Practices

### Input Validation

```typescript
import { z } from 'zod';

// IMMER validieren mit Zod Schema
const UserInput = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(128),
  name: z.string().min(1).max(100),
});

function createUser(input: unknown) {
  const validated = UserInput.parse(input); // Throws on invalid
  // ...
}
```

### Secret Management

```typescript
// NIEMALS Secrets im Code!

// SCHLECHT
const API_KEY = 'sk-1234567890';

// GUT
const API_KEY = process.env.API_KEY;
if (!API_KEY) throw new Error('API_KEY not configured');
```

### SQL Injection Prevention

```typescript
// IMMER parameterized queries!

// SCHLECHT
const user = await db.query(`SELECT * FROM users WHERE id = '${userId}'`);

// GUT (mit Drizzle ORM)
const user = await db.select().from(users).where(eq(users.id, userId));
```

### XSS Prevention

```typescript
// React escaped by default, aber NIEMALS dangerouslySetInnerHTML!

// SCHLECHT
<div dangerouslySetInnerHTML={{ __html: userInput }} />

// GUT
<div>{sanitizedContent}</div>
```

### Dependency Security

```bash
# Vor jedem Release:
npm audit
npm audit fix

# Bei kritischen Vulnerabilities: SOFORT fixen!
```

---

## 8. Error Handling

### Custom Errors

```typescript
// src/lib/errors.ts
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public isOperational: boolean = true
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 'NOT_FOUND', 404);
  }
}
```

### Error Handling Pattern

```typescript
// API Handler
async function handler(req: Request, res: Response) {
  try {
    const result = await service.process(req.body);
    res.json(result);
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
    } else if (error instanceof NotFoundError) {
      res.status(404).json({ error: error.message });
    } else {
      logger.error('Unexpected error', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
```

---

## 9. Logging Standards

### Log Levels

| Level | Verwendung |
|-------|------------|
| `error` | Unerwartete Fehler, System-Probleme |
| `warn` | Potenziell problematische Situationen |
| `info` | Wichtige Business-Events |
| `debug` | Detaillierte Debugging-Informationen |

### Structured Logging

```typescript
import { logger } from './lib/logger';

// IMMER strukturiert loggen!
logger.info('User created', {
  userId: user.id,
  email: user.email,
  source: 'registration',
});

logger.error('Payment failed', {
  userId,
  amount,
  error: error.message,
  stack: error.stack,
});
```

### Sensitive Data

```typescript
// NIEMALS sensitive Daten loggen!
// Logger sanitized automatisch (siehe TASK-035)

// SCHLECHT
logger.info('Login', { password: user.password });

// GUT
logger.info('Login attempt', { email: user.email });
```

---

## 10. Async/Await Best Practices

### Error Propagation

```typescript
// Immer async/await statt .then()/.catch()
async function processOrder(orderId: string): Promise<Order> {
  const order = await db.orders.findById(orderId);
  if (!order) throw new NotFoundError('Order');

  const payment = await paymentService.process(order);
  await notificationService.sendConfirmation(order, payment);

  return order;
}
```

### Parallel Execution

```typescript
// Unabhängige Operationen parallel!
const [user, orders, notifications] = await Promise.all([
  userService.getById(userId),
  orderService.getByUser(userId),
  notificationService.getUnread(userId),
]);

// Mit Error-Toleranz
const results = await Promise.allSettled([...promises]);
const successful = results.filter(r => r.status === 'fulfilled');
```

---

## 11. Code Review Checklist

Vor jedem PR Merge prüfen:

- [ ] TypeScript strict mode ohne Errors
- [ ] ESLint/Prettier ohne Warnings
- [ ] Tests geschrieben und grün
- [ ] Coverage-Minimum erreicht
- [ ] Conventional Commit Message
- [ ] Keine Secrets im Code
- [ ] Keine `console.log` (nur logger)
- [ ] Error Handling implementiert
- [ ] Input Validation vorhanden
- [ ] Dokumentation aktualisiert

---

---

## 12. SHIBC Website Stack

Die offizielle Website (shibaclassic.io) verwendet folgenden Stack:

| Komponente | Technologie | Version |
|------------|-------------|---------|
| Framework | Next.js (App Router) | ^15.1.0 |
| UI Library | MUI (Material UI) | ^7.0.0 |
| CMS | Directus (Headless) | latest |
| Hosting | Docker auf Portainer | - |

### MUI 7 Theme

Das MUI Theme ist bereits konfiguriert - **NICHT neu erstellen!**

```typescript
// Theme bereits vorhanden in der Website
// Bei Komponenten: import { useTheme } from '@mui/material'
```

### Directus Integration

```typescript
// CMS Content via MCP Worker
{"actions": [{"type": "spawn_worker", "task": "Get content from Directus collection 'pages'", "servers": ["directus"]}]}
```

---

## Referenzen

- [TypeScript Best Practices](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [OWASP Top 10](https://owasp.org/Top10/)
- [Vitest Documentation](https://vitest.dev/)
- [Zod Validation](https://zod.dev/)
- [MUI Documentation](https://mui.com/)
- [Directus Documentation](https://docs.directus.io/)
