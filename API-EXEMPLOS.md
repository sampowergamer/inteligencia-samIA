# API MinhaIA — exemplos de integração

A API fica disponível depois que o projeto Supabase for configurado, o schema SQL for executado e a Edge Function `knowledge-api` for publicada.

## Endpoint

`https://SEU-PROJETO.supabase.co/functions/v1/knowledge-api`

Todas as chamadas usam o cabeçalho `x-api-key`. Gere a chave na tela **Conta e nuvem → API universal MinhaIA**. A chave completa é mostrada uma única vez.

## Consultar conhecimentos

```bash
curl "https://SEU-PROJETO.supabase.co/functions/v1/knowledge-api" \
  -H "x-api-key: mia_SUA_CHAVE"
```

Pesquisar pelo título:

```bash
curl "https://SEU-PROJETO.supabase.co/functions/v1/knowledge-api/search?q=procedimento" \
  -H "x-api-key: mia_SUA_CHAVE"
```

## Cadastrar conhecimento

```bash
curl -X POST "https://SEU-PROJETO.supabase.co/functions/v1/knowledge-api" \
  -H "x-api-key: mia_SUA_CHAVE" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Procedimento de atendimento",
    "summary": "Etapas principais do atendimento",
    "content": "1. Receber a solicitação. 2. Entender a necessidade. 3. Registrar a solução.",
    "category": "Procedimentos",
    "tags": ["atendimento", "processo"],
    "agents": ["jose", "samuel"]
  }'
```

## Atualizar conhecimento

```bash
curl -X PATCH "https://SEU-PROJETO.supabase.co/functions/v1/knowledge-api" \
  -H "x-api-key: mia_SUA_CHAVE" \
  -H "Content-Type: application/json" \
  -d '{"id":"ID_DO_CONHECIMENTO","summary":"Resumo revisado"}'
```

## Excluir conhecimento

A chave precisa ter permissão `delete`.

```bash
curl -X DELETE "https://SEU-PROJETO.supabase.co/functions/v1/knowledge-api?id=ID_DO_CONHECIMENTO" \
  -H "x-api-key: mia_SUA_CHAVE"
```

## Permissões

- `read`: consultar e pesquisar.
- `write`: cadastrar e atualizar.
- `delete`: excluir.

Crie chaves separadas para cada IA ou agente. Se uma integração for comprometida, revogue apenas a chave dela no SQL Editor, usando o prefixo que identifica a chave:

```sql
update public.api_keys set revoked_at = now() where key_prefix = 'mia_PREFIXO';
```

Nunca coloque a chave em prompts públicos, repositórios ou JavaScript de sites públicos. Guarde-a no servidor/conector seguro da IA.

## Formato de resposta

A API responde JSON. Exemplo de consulta:

```json
{
  "data": [
    {
      "id": "uuid-do-registro",
      "title": "Procedimento de atendimento",
      "summary": "Etapas principais do atendimento",
      "content": "...",
      "category": "Procedimentos",
      "tags": ["atendimento"],
      "agents": ["jose"],
      "updatedAt": "2026-11-06T20:00:00.000Z"
    }
  ]
}
```
