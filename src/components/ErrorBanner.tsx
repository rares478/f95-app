import type { BackendError } from '../types';

interface Props {
  error: BackendError | string;
  onDismiss?: () => void;
}

const FRIENDLY: Record<string, string> = {
  invalid_credentials: 'Usuário ou senha incorretos.',
  two_factor_required:
    'Esta conta tem autenticação de dois fatores ativa. Suporte a 2FA não está implementado nesta versão.',
  cloudflare:
    'O Cloudflare bloqueou a requisição (Just a moment…). Esta versão não resolve o desafio — precisaria habilitar Playwright no sidecar.',
  sidecar_timeout: 'Sem resposta do sidecar Node. Verifique se o processo está rodando.',
  sidecar_crash: 'O sidecar Node terminou de forma inesperada.',
  not_initialized: 'A ponte com o sidecar ainda não foi inicializada.',
  protocol: 'Erro de protocolo entre Tauri e o sidecar.',
  io: 'Erro de IO ao falar com o sidecar.',
  other: 'Erro inesperado.',
};

export function ErrorBanner({ error, onDismiss }: Props) {
  const isBackend = typeof error !== 'string';
  const title = isBackend ? FRIENDLY[error.code] ?? 'Erro' : 'Erro';
  const detail = isBackend ? error.message : error;

  return (
    <div
      style={{
        border: '1px solid #b00020',
        background: '#fde7ea',
        color: '#5a0010',
        padding: '0.75rem 1rem',
        borderRadius: 6,
        margin: '0.5rem 0',
        fontSize: 14,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
        <div>
          <strong>{title}</strong>
          {detail && detail !== title && (
            <div style={{ opacity: 0.85, marginTop: 4 }}>{detail}</div>
          )}
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#5a0010',
              cursor: 'pointer',
              fontSize: 18,
              padding: 0,
              lineHeight: 1,
            }}
            aria-label="Fechar"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
