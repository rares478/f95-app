# Участие в разработке F95 App

**Языки:** [English](CONTRIBUTING.md) · [Português (BR)](CONTRIBUTING.pt-BR.md) · [Deutsch](CONTRIBUTING.de.md) · Русский

Спасибо, что смотрите код. Здесь — настройка окружения, именование веток, коммиты и pull request'ы.

Репозиторий: [github.com/jky-sh/f95-app](https://github.com/jky-sh/f95-app)

---

## Перед началом

### Требования

- Node.js 20+
- Rust stable ([rustup](https://rustup.rs/))
- Tauri v2 CLI (входит в `npm install`)
- Windows: WebView2, MSVC build tools (для нативных крейтов и оверлея)

### Клонирование и запуск

```bash
git clone https://github.com/jky-sh/f95-app.git
cd f95-app
npm install
npm --prefix src-tauri/sidecar install
npm run tauri dev
```

### `browser-rest-api`

Sidecar зависит от HTTP-клиента. Выберите setup под вашу цель:

**Локальная разработка** — клонируйте `browser-api` рядом с `f95-app`:

```
Projetos/
├── browser-api/
└── f95-app/
```

Sidecar резолвит через `file:../../../browser-api` в `src-tauri/sidecar/package.json`.

**Release / npm** — корневой `package.json` использует `browser-rest-api@^1.0.0` из registry. Для release-сборок укажите sidecar на ту же опубликованную версию.

### После правок sidecar

```bash
npm --prefix src-tauri/sidecar run build
```

Перезапустите или дайте `tauri dev` подхватить изменения.

### Тесты sidecar

```bash
npm --prefix src-tauri/sidecar test
```

---

## Где что менять

| Слой | Путь | Язык |
|------|------|------|
| UI | `src/pages/`, `src/components/` | TypeScript/React |
| Логика frontend | `src/lib/`, `src/contexts/` | TypeScript |
| Команды Tauri | `src-tauri/src/commands/` | Rust |
| Загрузки | `src-tauri/src/download/` | Rust |
| Оверлей | `src-tauri/src/overlay*.rs` | Rust |
| Парсинг F95/SAM | `src-tauri/sidecar/src/domain/` | TypeScript |
| Резолверы хостов | `src-tauri/sidecar/src/domain/resolvers/` | TypeScript |
| Переводы | `src/locales/*.ts` | TypeScript |
| Схема БД | `src-tauri/src/migrations.rs` | SQL + Rust |

Детали архитектуры: [docs/ARCHITECTURE.ru.md](docs/ARCHITECTURE.ru.md)

---

## Ветки

Базовая ветка: `main`.

Одна тема на ветку. Синхронизируйтесь с `main` перед PR (merge или rebase — на ваш выбор, но история должна читаться).

| Префикс | Назначение | Пример |
|---------|------------|--------|
| `feature/` | Новая функция | `feature/library-sort` |
| `fix/` | Исправление бага | `fix/mega-download-resume` |
| `docs/` | Только документация | `docs/readme-de` |
| `refactor/` | Изменение кода без смены поведения | `refactor/ipc-types` |
| `chore/` | Сборка, зависимости, инструменты | `chore/update-playwright` |

```bash
git checkout main
git pull origin main
git checkout -b feature/my-change
```

---

## Коммиты

Используем [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <краткое описание>

[опциональное тело — объясните зачем, не только что]
```

### Types

| Type | Когда |
|------|-------|
| `feat` | Новая функция |
| `fix` | Исправление бага |
| `docs` | Документация |
| `refactor` | Рефакторинг без изменения поведения |
| `test` | Тесты |
| `chore` | Обслуживание, deps, CI |
| `perf` | Улучшение производительности |

### Scopes

Указывайте scope, когда изменение чётко ограничено:

`frontend`, `tauri`, `sidecar`, `download`, `overlay`, `i18n`, `db`

Без scope — для изменений по всему репо или тривиальных.

### Примеры

```
feat(download): add pixeldrain resolver
fix(overlay): anchor window on DPI change
docs: add German README
refactor(sidecar): split auth handler from registry
chore: bump playwright to 1.61
```

Правила:

- Повелительное наклонение в заголовке (`add`, не `added`)
- Заголовок ≤ 72 символов
- Одно логическое изменение на коммит, где возможно
- Не коммитьте учётные данные, файлы сессий или личные данные

---

## Pull requests

### Заголовок

Как основной коммит: `feat(download): add pixeldrain resolver`

### Описание

Включите:

1. **Что** изменилось
2. **Зачем** это нужно
3. **Как тестировать** — команды, ручные шаги

Связывайте issues: `Fixes #123` или `Refs #123`.

### Размер

Держите PR сфокусированными. Большие изменения делите на части для ревью (например, Rust-резолвер отдельно от UI).

### Чеклист

Шаблон PR (`.github/pull_request_template.md`):

- [ ] `npm run build` проходит
- [ ] `npm --prefix src-tauri/sidecar test` (если меняли sidecar)
- [ ] Проверено в `npm run tauri dev` (если меняли Rust/IPC/интеграцию UI)
- [ ] Нет секретов и данных сессий в коммитах

### Процесс ревью

1. Откройте PR в `main`
2. Дождитесь ревью (небольшой проект — нужно терпение)
3. Отвечайте на замечания дополнительными коммитами
4. Squash-merge или merge commit — решает мейнтейнер

---

## Стиль кода

Строгий линтер пока не настроен. Следуйте окружающему файлу:

- **TypeScript/React** — функциональные компоненты, хуки, существующие имена (`camelCase` функции, `PascalCase` компоненты)
- **Rust** — стандарты `rustfmt`, `thiserror` для новых типов ошибок
- **Sidecar** — обработчики в `src/rpc/handlers/`, доменная логика в `src/domain/`

Запускайте `npm run build` перед push frontend-изменений. `cargo check` в `src-tauri/` для Rust.

---

## Сообщение об ошибках

Откройте issue на GitHub с:

- ОС и версия приложения
- Шаги воспроизведения
- Ожидаемое vs фактическое поведение
- Релевантные логи (удалите учётные данные и токены сессий)

---

## Лицензия

Участвуя в проекте, вы соглашаетесь, что ваш вклад будет лицензирован под [GNU GPL v3.0 или позднее](LICENSE) — той же лицензией, что и проект.
