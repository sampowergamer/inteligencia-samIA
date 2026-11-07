# Central de Conhecimento MinhaIA 2.0

Painel responsivo para computador e Android, com armazenamento local IndexedDB, conexão opcional ao Supabase, sincronização de registros, armazenamento privado de anexos e uma Edge Function para API externa.

## O que está incluído

- `index.html`, `style.css`, `app.js`: painel web.
- `supabase/schema.sql`: banco, autenticação por workspace, RLS, Storage e emissão de chaves API.
- `supabase/functions/knowledge-api/index.ts`: API REST para leitura, cadastro, atualização e exclusão controlada.
- `supabase/config.toml`: configuração da função sem JWT obrigatório no gateway; a própria função valida a chave `x-api-key`.
- `API-EXEMPLOS.md`: exemplos cURL.

## Atenção: ainda não está publicado nem conectado ao seu projeto

O código vem preparado para conexão, mas não existe projeto Supabase, URL, chave, workspace ou Edge Function configurados nesta entrega. Você precisa criar seu projeto e seguir os passos abaixo. Não informe sua senha de login, chave secreta ou service role no chat.

## 1. Fazer uma cópia de segurança da versão 1.0

1. Abra a versão antiga no mesmo navegador/dispositivo onde os conhecimentos foram cadastrados.
2. Entre em **Backup e exportação**.
3. Clique em **Exportar biblioteca JSON** e guarde o arquivo fora do navegador.
4. Guarde também os anexos originais separadamente, se forem importantes.
5. Só depois abra a versão 2.0. A primeira sincronização para uma nuvem vazia enviará os registros locais existentes.

A versão 2.0 usa o mesmo nome de banco IndexedDB (`minhaia_central_conhecimento`) para facilitar a continuidade no mesmo navegador. Isso não transfere automaticamente os dados de outro aparelho ou navegador.

## 2. Criar o projeto Supabase

1. Acesse https://supabase.com/ e crie um projeto.
2. Escolha uma senha forte para o banco e guarde-a no seu gerenciador de senhas. Essa senha não é a senha de login do painel.
3. No painel do projeto, abra **SQL Editor → New query**.
4. Abra `supabase/schema.sql`, copie todo o conteúdo e execute.
5. Em **Project Settings → API**, copie a **Project URL** e a chave **publishable** (ou a chave `anon` legada, se for a que seu projeto mostrar).
6. No painel MinhaIA, clique em **Conta e nuvem**, cole a URL e a chave publishable e clique em **Salvar configuração**.
7. Crie uma conta com e-mail e senha pela própria janela. Se a confirmação por e-mail estiver ativa, confirme o e-mail antes de entrar.
8. Entre na conta. A primeira conexão cria um workspace. Se ele estiver vazio, os registros locais são enviados para a nuvem; se já houver dados, a biblioteca da nuvem substitui a cópia local para evitar misturar workspaces.

**Nunca use a chave `service_role` ou uma chave `secret` no navegador.** O frontend usa somente URL + publishable/anon e as políticas RLS do SQL.

## 3. Compartilhar o workspace com outras pessoas

1. A pessoa cria sua conta pelo botão **Criar conta** no painel e confirma o e-mail, se solicitado. Ela ainda não deve clicar em **Entrar**.
2. O proprietário abre Supabase → Authentication → Users e confirma que o usuário existe.
3. No Supabase SQL Editor, consulte o workspace e o usuário:

```sql
select id, name from public.workspaces;
select id, email from auth.users;
```

4. Adicione o usuário como membro, usando os IDs reais retornados. Faça isso antes do primeiro login dessa pessoa no painel para que ela entre diretamente no workspace compartilhado:

```sql
insert into public.workspace_members(workspace_id, user_id, role)
values ('UUID_DO_WORKSPACE', 'UUID_DO_USUARIO', 'member')
on conflict (workspace_id, user_id) do update set role = excluded.role;
```

Papéis disponíveis: `owner`, `admin`, `member` e `viewer`. Os papéis `owner`, `admin` e `member` podem editar; `viewer` tem somente leitura no banco e nos arquivos.

## 4. Publicar a API universal

A função precisa ser implantada no Supabase. O caminho recomendado é pelo Supabase CLI, a partir de um computador ou ambiente de desenvolvimento com Deno/Node e CLI instalados:

```bash
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase functions deploy knowledge-api --no-verify-jwt
```

O projeto deve ter `supabase/config.toml` e `supabase/functions/knowledge-api/index.ts` no caminho indicado. A função usa as variáveis `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` do ambiente Supabase; não as copie para o HTML/JS.

O endpoint será:

`https://SEU-PROJETO.supabase.co/functions/v1/knowledge-api`

Depois de publicar, abra **Conta e nuvem → API universal MinhaIA**, gere uma chave com as permissões necessárias e guarde-a. A chave é exibida apenas uma vez. A função aceita `x-api-key` e verifica hash, workspace, revogação e permissões.

Consulte `API-EXEMPLOS.md` para exemplos de leitura, busca, cadastro, atualização e exclusão.

## 5. Segurança e limites

- A autenticação do painel usa Supabase Auth; não existe senha administrativa fixa embutida no código.
- A chave publishable/anon é pública por natureza e só é segura com RLS ativo.
- A chave service role fica exclusivamente no ambiente da Edge Function.
- As chaves de API externas são armazenadas como hash; a chave original aparece somente na criação.
- Crie uma chave diferente para cada IA e conceda apenas as permissões necessárias.
- A API não deve receber segredos, senhas bancárias, tokens privados ou informações sensíveis nos conteúdos.
- O plano gratuito não garante serviço ou armazenamento para sempre. Faça backups externos regulares e monitore os limites e regras do provedor.

## 6. Sincronização e modo offline

- Com sessão e internet, as alterações são gravadas localmente e enviadas ao Supabase.
- Se uma alteração falhar por falta de conexão, a aplicação registra uma fila local para tentar sincronizar novamente quando voltar online.
- A primeira conexão de um workspace vazio envia os dados locais; se já houver dados remotos, o app baixa os registros do workspace.
- Evite editar o mesmo conhecimento simultaneamente em vários dispositivos durante esta primeira versão. Ainda não há resolução avançada de conflitos por campo.
- Os metadados dos anexos sincronizam e o arquivo original é enviado ao bucket privado `knowledge-files`.

## 7. Teste pelo Android

1. Baixe e extraia o ZIP no gerenciador de arquivos.
2. Abra o `index.html` no navegador apenas para testar a interface local. Alguns navegadores bloqueiam recursos ou autenticação em arquivos `file://`; para testar login e nuvem de verdade, publique em HTTPS.
3. No Android, use Chrome ou outro navegador atualizado. Configure o Supabase, crie a conta e entre.
4. Cadastre um conhecimento de teste, feche e reabra o navegador, depois confirme que o registro continua lá.
5. Entre no mesmo workspace em outro dispositivo autorizado e confira a sincronização.
6. Teste anexos pequenos antes de enviar documentos grandes.

## 8. Hospedagem gratuita

Para publicar o frontend, use Cloudflare Pages com integração Git:

1. Crie um repositório privado no GitHub e envie os arquivos do projeto.
2. Na Cloudflare, abra Workers & Pages → Create → Pages → Connect to Git.
3. Escolha o repositório; para este site estático, deixe o comando de build vazio e o diretório de saída como `/` (raiz).
4. Publique e teste o endereço HTTPS gerado.

Escolha Git Integration desde o início. Um projeto criado por Direct Upload não pode ser convertido posteriormente para Git Integration. O plano gratuito tem limites e políticas que podem mudar; consulte os termos atuais antes de publicar.

## 9. Limitações conhecidas desta versão 2.0

- A conexão cloud e a sincronização exigem que o usuário configure seu próprio projeto Supabase. Não estão ativadas antes disso.
- O compartilhamento entre membros depende de adicionar cada usuário a `workspace_members`.
- O perfil `viewer` ainda não tem bloqueio de escrita próprio nesta primeira versão.
- A API REST é uma base inicial de integração, não um servidor MCP. Uma IA precisa suportar HTTP/REST ou usar um conector/ação intermediária.
- A busca API inicial filtra por título; busca semântica/vetorial (embeddings/RAG) fica para uma etapa futura.
- Áudio e vídeo continuam sem transcrição automática. Os anexos podem ser armazenados, mas é necessário conectar um serviço de transcrição para extrair fala.
- Não há merge inteligente de edições simultâneas.
- Faça backup JSON e dos arquivos anexos antes de qualquer migração ou atualização importante.
