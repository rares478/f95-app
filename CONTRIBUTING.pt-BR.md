# Contribuindo com o F95 App

**Idiomas:** [English](CONTRIBUTING.md) · Português (BR) · [Deutsch](CONTRIBUTING.de.md) · [Русский](CONTRIBUTING.ru.md)

Obrigado por olhar o código. Este documento cobre como montar o ambiente de dev, nomear branches, escrever commits e abrir pull requests.

Repositório: [github.com/rares478/f95-app](https://github.com/rares478/f95-app)

---

## Antes de começar

### Pré-requisitos

- Node.js 20+
- Rust stable ([rustup](https://rustup.rs/))
- Tauri v2 CLI (incluído via `npm install`)
- Windows: WebView2, MSVC build tools (necessários para crates nativos e overlay)

### Clone e execução

```bash
git clone https://github.com/rares478/f95-app.git
cd f95-app
npm install
npm --prefix src-tauri/sidecar install
npm run tauri dev
```

### `browser-rest-api`

O sidecar depende de um pacote de cliente HTTP. Escolha o setup conforme seu objetivo:

**Desenvolvimento local** — clone o repositório `browser-api` como irmão de `f95-app`:

```
Projetos/
├── browser-api/
└── f95-app/
```

O sidecar resolve via `file:../../../browser-api` em `src-tauri/sidecar/package.json`.

**Release / npm** — o `package.json` raiz usa `browser-rest-api@^1.0.0` do registry. Em builds de release, aponte o sidecar para a mesma versão publicada.

### Depois de editar o sidecar

```bash
npm --prefix src-tauri/sidecar run build
```

Reinicie ou deixe o `tauri dev` pegar as mudanças.

### Testes do sidecar

```bash
npm --prefix src-tauri/sidecar test
```

---

## Onde editar

| Camada | Caminho | Linguagem |
|--------|---------|-----------|
| UI | `src/pages/`, `src/components/` | TypeScript/React |
| Lógica frontend | `src/lib/`, `src/contexts/` | TypeScript |
| Comandos Tauri | `src-tauri/src/commands/` | Rust |
| Downloads | `src-tauri/src/download/` | Rust |
| Overlay | `src-tauri/src/overlay*.rs` | Rust |
| Parse F95/SAM | `src-tauri/sidecar/src/domain/` | TypeScript |
| Resolvers de hosts | `src-tauri/sidecar/src/domain/resolvers/` | TypeScript |
| Traduções | `src/locales/*.ts` | TypeScript |
| Schema do banco | `src-tauri/src/migrations.rs` | SQL + Rust |

Detalhes de arquitetura: [docs/ARCHITECTURE.pt-BR.md](docs/ARCHITECTURE.pt-BR.md)

---

## Branches

Branch base: `main`.

Um assunto por branch. Sincronize com `main` antes de abrir o PR (merge ou rebase — sua escolha, mas mantenha o histórico legível).

| Prefixo | Uso | Exemplo |
|---------|-----|---------|
| `feature/` | Nova funcionalidade | `feature/library-sort` |
| `fix/` | Correção de bug | `fix/mega-download-resume` |
| `docs/` | Só documentação | `docs/readme-de` |
| `refactor/` | Mudança de código, mesmo comportamento | `refactor/ipc-types` |
| `chore/` | Build, deps, tooling | `chore/update-playwright` |

```bash
git checkout main
git pull origin main
git checkout -b feature/minha-mudanca
```

---

## Commits

Usamos [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <descrição curta>

[corpo opcional — explique o porquê, não só o quê]
```

### Types

| Type | Quando |
|------|--------|
| `feat` | Nova feature |
| `fix` | Correção de bug |
| `docs` | Documentação |
| `refactor` | Refatoração sem mudança de comportamento |
| `test` | Testes |
| `chore` | Manutenção, deps, CI |
| `perf` | Melhoria de performance |

### Scopes

Use um scope quando a mudança for claramente delimitada:

`frontend`, `tauri`, `sidecar`, `download`, `overlay`, `i18n`, `db`

Omita o scope para mudanças globais ou triviais.

### Exemplos

```
feat(download): add pixeldrain resolver
fix(overlay): anchor window on DPI change
docs: add German README
refactor(sidecar): split auth handler from registry
chore: bump playwright to 1.61
```

Regras:

- Modo imperativo na linha de assunto (`add`, não `added`)
- Assunto com até 72 caracteres
- Uma mudança lógica por commit quando possível
- Não commite credenciais, arquivos de sessão ou dados pessoais

---

## Pull requests

### Título

Igual ao commit principal: `feat(download): add pixeldrain resolver`

### Descrição

Inclua:

1. **O que** mudou
2. **Por que** foi necessário
3. **Como testar** — comandos executados, passos manuais

Linke issues com `Fixes #123` ou `Refs #123`.

### Tamanho

Mantenha PRs focados. Divida mudanças grandes em partes revisáveis (ex.: resolver Rust separado da UI).

### Checklist

O template de PR (`.github/pull_request_template.md`) cobre:

- [ ] `npm run build` passa
- [ ] `npm --prefix src-tauri/sidecar test` (se alterou sidecar)
- [ ] Testado com `npm run tauri dev` (se alterou Rust/IPC/integração UI)
- [ ] Sem segredos ou dados de sessão commitados

### Processo de review

1. Abra PR contra `main`
2. Aguarde review (projeto pequeno — tenha paciência)
3. Atenda feedback com commits adicionais
4. Squash-merge ou merge commit — mantenedor decide

---

## Estilo de código

Sem linter rígido ainda. Siga o arquivo ao redor:

- **TypeScript/React** — componentes funcionais, hooks, nomenclatura existente (`camelCase` funções, `PascalCase` componentes)
- **Rust** — padrões `rustfmt`, `thiserror` para novos tipos de erro
- **Sidecar** — handlers em `src/rpc/handlers/`, lógica de domínio em `src/domain/`

Rode `npm run build` antes de push de mudanças no frontend. `cargo check` em `src-tauri/` para mudanças Rust.

---

## Reportar bugs

Abra uma issue no GitHub com:

- SO e versão do app
- Passos para reproduzir
- Comportamento esperado vs real
- Logs relevantes (remova credenciais e tokens de sessão)

---

## Licença

Ao contribuir, você concorda que suas contribuições serão licenciadas sob a [GNU GPL v3.0 ou posterior](LICENSE), a mesma licença do projeto.
