# Como contribuir

[English](CONTRIBUTING.md)

Qualquer pessoa pode propor um tipo de conexão, um template ou um pacote. Abra
um PR que adiciona ou muda um arquivo; a CI valida e quem mantém revisa.

## Rodar o validador

Node 20 ou mais novo:

```sh
npm ci --ignore-scripts
npm run validate                                  # o catálogo inteiro
node scripts/validate.mjs templates/meu-item.json # um arquivo
npm test
```

Cada erro diz o arquivo e o campo, como
`templates/meu-item.json: name.pt-BR: "pt-BR" is required`.

Quem mantém guarda uma lista de termos proibidos (nomes de empresa, time e
pessoa) fora do repositório, em `~/.config/locum/termos-proibidos` ou no
caminho de `LOCUM_TERMOS_PROIBIDOS`. Com a lista, `npm run validate` falha em
qualquer arquivo versionado que tenha um deles; sem ela, avisa e segue.

## O envelope

Todo item é `<pasta>/<id>.json`:

| campo | |
| :--- | :--- |
| `kind` | `connection` em `connections/`, `template` em `templates/`, `package` em `packages/` |
| `id` | kebab-case, igual ao nome do arquivo, único no catálogo inteiro |
| `version` | inteiro, começa em 1 e sobe a cada mudança; a CI confere contra a base do PR |
| `name`, `description` | `{"en": "...", "pt-BR": "..."}`, os dois idiomas obrigatórios |
| `tags` | opcional, kebab-case |
| `minAppVersion` | a versão mais antiga do Locum que instala o item, `x.y.z`: obrigatória em conexão, opcional em template; o README diz quando declarar |
| `manifest` ou `package` | o corpo, abaixo |

Os esquemas estão em [`schemas/`](schemas/): `envelope.schema.json` e um por
kind.

Em `name` e `description`, de qualquer kind, o validador recusa caractere que
esconde ou inverte o que a pessoa lê: controle de direção (U+061C, U+200E,
U+200F, U+202A a U+202E, U+2066 a U+2069), largura zero isolada (U+200B,
U+2060, U+FEFF) e caractere de controle fora `\n` e `\t`. Em tipo de conexão
o app também recusa; em template e pacote, só o catálogo confere. ZWJ (U+200D), ZWNJ (U+200C) e o hífen suave (U+00AD) passam:
compõem emoji, como `👩‍💻`, e palavra.

## Tipos de conexão

Toda conexão que o Locum conhece vem deste catálogo (ADR 0018 do app),
inclusive as que vinham dentro do app. Qualquer pessoa pode propor uma nova;
os ids oficiais, abaixo, só quem mantém publica.

`manifest` descreve o tipo como dado. Ele escolhe mecanismos que o núcleo do
app já tem e nunca traz código:

- `category`, `logo` (ou `null`), `color` (hex sem `#`);
- `methods`, na ordem em que a tela oferece, cada tipo no máximo uma vez:
  - `oauth`, com `scopes` opcional;
  - `token`, com `header` (servidor remoto) ou `env` (servidor local)
    opcional, onde vai a credencial;
  - `cli` com `reader: "gh"`, a credencial de outra ferramenta de linha de
    comando;
  - `session` com `reader: "browser-cookie"` ou `"slack-desktop"`, a sessão
    que a pessoa já tem. Cookie e domínio ficam no leitor, no app;
  - `none`.

  `cli` e `session` leem credencial da máquina da pessoa, então só tipo
  oficial os usa.
- `fields`: o formulário que a instância preenche além do nome, cada campo com
  `key`, `label`, `help` opcional, `placeholder` opcional (a dica do campo
  vazio, como o endereço padrão, que nunca vira valor gravado), `format`
  (`url` ou `text`) e `required`. `help` e `placeholder` são texto nos dois
  idiomas, como o `label`;
- `servers`, com ao menos um de:
  - `remote`: `{"url": "https://..."}` para endereço fixo, ou
    `{"urlField": "<key>"}` quando a pessoa digita o endereço num campo `url`
    obrigatório, com `path` opcional somado ao fim dele (`"/mcp"`, sem
    marcador nem segmento `.` ou `..`). `headers` opcional, onde vai o
    `${credential}`;
  - `local`: `{"image": "registro/nome@sha256:<64 hex>"}` ou
    `{"package": {"registry": "npm", "name", "version", "bin", "lockfile"}}`,
    com `args` e `env` opcionais. No catálogo, só tipo oficial publica
    servidor local, e só por imagem, que o app sobe com `docker run`; o pacote
    e o servidor local de terceiro esperam o app fixá-los numa release
    seguinte.

  Os valores de `url` (só no caminho), `headers`, `args` e `env` aceitam
  `${field:<key>}`, o valor de um campo declarado em `fields`. O
  `${credential}` vai num lugar só de cada servidor, um cabeçalho do remoto ou
  uma variável do local, e é o lugar que o método `token` declara em `header`
  ou `env`, quando declara.
- `healthCheck`: o teste da instância, até três GETs na base do servidor
  remoto (o endereço do `urlField`, ou o `servers.remote.url`), cada um com um
  `path` e os `fields` da resposta JSON a mostrar, de 1 a 10, cada um com uma
  `key` do primeiro nível e um `label`:

  ```json
  "healthCheck": [
    { "path": "/api/health", "fields": [{ "key": "version", "label": { "en": "Version", "pt-BR": "Versão" } }] }
  ]
  ```

  O `path` é relativo e somado ao fim da base: começa com `/` e não tem
  segmento `.` ou `..`, esquema, host, consulta, âncora nem marcador. Só vale
  com `servers.remote`;
- `triggers`: tipos de gatilho do núcleo que leem este tipo (`poll` lê
  `github`, `slack-inbox` lê `slack`...) ou um servidor dele (`mcp-poll`);
- `actions`: ações de fluxo do núcleo que precisam do tipo, como
  `<id>.<ação>`;
- `trackers`, `scopeKeys` (com o id como prefixo), `hosts`, `aliases` e
  `packages`, que identificam o tipo;
- `writeTools`: as ferramentas do servidor que escrevem fora da máquina.

Tipo sem `servers`, `triggers` nem `actions` não faz nada e é recusado. O
esquema é o [`schemas/connection.schema.json`](schemas/connection.schema.json).

### O que é recusado

- `command`, `npx`, `uvx` ou qualquer jeito de rodar script.
- `url` remota que não é https, traz usuário ou senha, tem `${credential}`
  (que pararia em log) ou `${field:...}` fora do caminho (no host, na porta,
  na consulta ou na âncora), escreve o host diferente da
  forma canônica (ASCII minúsculo, punycode, sem ponto final, o que pega
  homógrafo) ou aponta para endereço IP, `localhost`, nome sem ponto ou sufixo
  privado (`.local`, `.localhost`, `.localdomain`, `.internal`, `.intranet`,
  `.corp`, `.private`, `.home`, `.home.arpa`, `.lan`, `.test`, `.example`,
  `.invalid`). O mesmo vale para `hosts`.
- `url` remota fixa num host fora de `hosts`, quando o tipo declara `hosts`:
  o app não instala o tipo, porque o token iria para um host que a pessoa não
  viu. Sem `hosts`, não há o que comparar; a porta não conta.
- Os mesmos caracteres recusados em `name` e `description` (veja o envelope)
  em `label`, `help` e `placeholder` de campo, `label` de campo do
  `healthCheck`, `description` de chave de escopo, `scopes` do método `oauth` e
  `writeTools`.
- `${credential}` fora de header do servidor remoto ou do `env` do local, em
  mais de um lugar do mesmo servidor ou fora do lugar que o método `token`
  declara; marcador que não é `${credential}` nem `${field:<key>}` de campo
  declarado; `path` sem `urlField`.
- `healthCheck` sem `servers.remote`; `path` de GET que não é relativo e limpo
  (como o `path` do servidor remoto) ou que aparece duas vezes; chave de campo
  repetida no mesmo GET.
- Em qualquer tipo, oficial incluído, campo `text` citado no servidor que
  recebe `${credential}`. Um texto livre numa variável, num argumento ou num
  cabeçalho pode apontar o servidor para outro host (`--base-url`,
  `API_HOST`) sem passar pela regra de origem que o app aplica ao campo `url`.
  Use um campo `url`.
- Tipo de gatilho, tipo de tracker ou ação que o núcleo não tem
  ([`scripts/lib/core-kinds.json`](scripts/lib/core-kinds.json) e os gatilhos
  do esquema de template), gatilho que lê outro tipo, e ação ou chave de escopo
  sem o id do tipo como prefixo.
- Host, apelido, pacote (o do servidor local incluído), tracker ou ação que
  outro tipo já usa, oficiais incluídos, e apelido igual ao id de outro tipo.
- Nome de exibição igual ao de um tipo oficial ou do `proprio`, em qualquer
  caixa ou acento: o app ignora o tipo que o usa.
- Em servidor local: imagem sem digest ou com tag junto, flag de runtime que
  alarga o contêiner (`--privileged`, `-v`, `--network`...), variável que muda
  como o processo carrega código ou sai para a rede (`NODE_OPTIONS`,
  `NODE_TLS_REJECT_UNAUTHORIZED`, `ELECTRON_RUN_AS_NODE`, `SSLKEYLOGFILE`,
  `LD_*`, `DYLD_*`, `PATH`, `PYTHONPATH`, proxies...), que muda o `docker` que
  sobe o servidor (`DOCKER_*`) ou que o cliente MCP sobrescreve (`HOME`,
  `LOGNAME`, `SHELL`, `TERM`, `USER`), a mesma lista do app, e entrada de lockfile sem
  `integrity`, resolvida fora de `https://registry.npmjs.org/` ou com script
  de instalação.
- Os ids `locum` e `proprio`, que o app reserva, e id igual a apelido de tipo
  oficial (o app casa o nome do servidor primeiro pelo id).

### Ids oficiais

Os ids de [`scripts/lib/official-connections.json`](scripts/lib/official-connections.json)
(`github`, `slack`, `teams`, `grafana`, `argocd` e os outros que
vinham dentro do app) só quem mantém publica. O
[`.github/CODEOWNERS`](.github/CODEOWNERS) dá cada `connections/<id>.json`
deles aos donos do próprio CODEOWNERS, e o `npm run validate` falha quando um
falta ou tem outro dono. Os donos só seguram o merge quando a proteção da
`main` exigir review de code owner, o que ainda não está ligado (veja o
[docs/connections-pending.md](docs/connections-pending.md)). Nenhum outro tipo pode usar os hosts, apelidos, pacotes e trackers
listados para eles.

Os tipos que vinham dentro do app estão em `connections/`, com o mesmo
conteúdo que o app usa hoje. O `argocd` está na lista para ninguém tomar o id
nem o nome do servidor que os templates pedem, mas não tem tipo no app: fica
sem arquivo até ter.

Ser oficial é uma marca no índice assinado, não algo que o item diz. O
`npm run build-index` põe `"official": true` na entrada de cada tipo de
conexão cujo id está em `official` dessa lista, e arquivo de item que declara
`official` é recusado. A partir da versão do app que lê a marca (ADR 0018,
fatia 4), o tipo oficial tem a confiança que os tipos de dentro do app têm
hoje: a rede de casa, os métodos que só tipo oficial usa (`cli` e `session`) e
o token do GitHub. Tipo de terceiro só alcança endereço público, e endereço
desta máquina só quando a pessoa digita. App anterior ignora a marca. O
`prelo` é publicado por quem mantém, e o CODEOWNERS deixa o arquivo com eles,
mas é tipo de terceiro: não está na lista, e a entrada dele no índice não tem
a marca.

### Como o app recebe, e as versões

O app lê os tipos de conexão do índice assinado, o embutido no build e o da
rede (ADR 0018, fatia 2), e "Adicionar conexão" lista os de terceiro com o
estado: "Ainda não instala", ou "Precisa atualizar o Locum" quando o
`minAppVersion` passa da versão do app. Nenhum instala ainda; a instalação é a
fatia 3. Tipo do índice com id ou apelido oficial é ignorado, e os oficiais
seguem vindo de dentro do app até a fatia 4, que passa a lê-los daqui. Até lá,
publicar ou mudar um oficial não muda nada para quem usa.

Tipo instalado vai ficar preso ao commit e ao `sha256` do arquivo. Quando
`version` subir, o app vai mostrar a atualização com o que mudou (fatia 5):

- mudança que não amplia o que o tipo pede (texto, ícone, campo, ferramenta de
  leitura) vai entrar sozinha, a não ser que a pessoa tenha desligado
  "atualizar sozinha" naquela conexão;
- mudança que amplia (host, escopo, método, ferramenta de escrita, imagem ou
  pacote novos) vai sempre esperar o aceite da pessoa, e a credencial nunca vai
  seguir para um host novo antes disso.

`minAppVersion` é obrigatório em tipo de conexão, em `0.1.168` ou mais nova, a
primeira release que lê tipos do índice. Suba o valor quando o tipo usar algo
que app mais velho não tem, método, leitor, tipo de gatilho, ação ou campo do
esquema: ele vai mostrar o tipo como "precisa atualizar" e manter o instalado
rodando. O `path` e os marcadores `${field:<key>}` entraram no esquema do app
em `0.1.170`: tipo que os usa precisa de `0.1.170` ou mais nova, como o
Grafana, e o validador recusa menos. O `placeholder` no campo e o
`healthCheck` entraram no esquema do catálogo do app em `0.1.182`: tipo que os
usa precisa de `0.1.182` ou mais nova, como o Prelo, porque o app anterior
mostra o tipo como inválido.

## Templates e pacotes

`package` é um pacote do Locum, o mesmo arquivo que o app exporta e importa
(`formato: "locum-pacote"`, `versao` de 1 a 4). Template é um pacote com a
automação montada e os nós à vista; pacote é o que alguém exportou do Locum.
Exporte pelo app, para sair já limpo, e cole em `package`.

Template traz ao menos um gatilho em `automacao.gatilhos`, sem o que é da
pessoa: dono, repositórios, canais, chats. O app pede isso na instalação. O
`$defs.trigger` de `schemas/template.schema.json` diz, por tipo, o que a pessoa
escolhe (`x-person-chooses`) e como o template deixa cada campo de fora: o app
precisa dele para criar o gatilho (`x-required-to-run`, nada a acrescentar),
uma entrada em `omitidos` com o código de `x-omitted-code` e
`onde: "gatilho:<posição>"` (em `argumentos`, com o campo em `params`), ou o
campo de `x-held-by` preenchido, que segura o gatilho até a pessoa escolher
(`chatsRestritos` no `teams-inbox`). Nenhum template varre todos os
repositórios ou todos os chats por deixar o campo vazio, e valor que pega tudo
(`x-catch-all`, como `repoMatch: ".*"`) conta como não escolhido.

Limite conhecido: o `myUserId` do `slack-inbox` só é preciso quando o Slack é
lido por um servidor MCP, e não pela conexão oficial. O esquema não tem como
dizer isso, então todo template com `slack-inbox` o deixa a escolher.

O que o gatilho lê precisa estar em `requisitos`: a conexão do tipo dele
(`x-reads-connection`) em `conexoes`, e o `server` de um `mcp-poll` em
`servidores`. Template só lê em `{{event.*}}` o que algum gatilho entrega,
nos campos que o app renderiza (o prompt, os `params` da ação e `value`,
`against` e `title` do passo lógico). `cron`, `schedule` e `webhook` não trazem
evento (`x-no-event`), e o run que um deles dispara roda sem evento, mesmo que
outro gatilho do template traga: template com algum deles busca pelas
ferramentas dos passos. Template que precisaria de um evento que nenhum
gatilho entrega fica fora do catálogo até o app ter esse gatilho. Pacote pode
vir sem gatilho.

Tipo de gatilho que tem `filter` também aceita `batch: {"windowMinutes",
"max"}` (`$defs.batch`, com os limites do app: de 1 a 10080 minutos e de 1 a
500 eventos). Sem ele, cada evento é um run. Com ele, os eventos que passam no
filtro juntam pela janela e viram um run só, e esse run lê o evento do lote:
`{{event.items}}` (os eventos, na ordem de chegada), `{{event.cut}}` (quantos
passaram de `max` e ficaram de fora), `{{event.deferred}}`, `{{event.count}}`,
`{{event.windowStart}}` e `{{event.windowEnd}}` (`x-event-fields`). Passo que lê
outro campo, como `{{event.channel}}`, é recusado, porque o evento do lote não
o tem: leia cada evento dentro de `{{event.items}}`. `batch` em tipo sem
`filter` é recusado, e template com `batch` precisa de `minAppVersion` `0.1.175`
ou mais nova, a primeira versão do app com lote. A janela e o máximo ficam
escritos no template, nunca a cargo do app. Também é recusado:

- `batch` em gatilho que deixa de fora um campo de `x-required-to-run` que não
  está em `x-pending-choice` (`repoMatch` no `poll`): sem ele o app não cria o
  gatilho na instalação e o descarta inteiro, com o lote junto, até a pessoa
  escolher. Gatilho segurado por `x-held-by` ou com entrada em `omitidos` é
  criado com a configuração inteira e mantém o lote. O campo que também está
  em `x-pending-choice` (`channels` no `slack-channel`) segura o gatilho a
  partir do app `0.1.177`, com a configuração inteira, até a pessoa escolher:
  template com `batch` nesse gatilho precisa de `minAppVersion` `0.1.177` ou
  mais nova, porque o app anterior o descarta. Pacote não declara
  `minAppVersion`, então nele o lote continua recusado;
- template em que um gatilho que entrega evento tem `batch` e outro não: o run
  de cada um lê um evento diferente, e nenhum prompt serve aos dois.

O `settleMinutes` do gatilho `poll`, a carência do gatilho (o commit novo só
dispara quando o head está parado há esse tempo), precisa de `minAppVersion`
`0.1.204` ou mais nova: o app anterior ignora o campo e dispara a cada commit.

O `filter` (`$defs.filter`) também segue o app: no máximo 20 condições, cada
uma com `path` (o caminho no evento, como `author.login`), `compare` (as
comparações do passo `if`) e `against` (até 500 caracteres). O `against` só
aceita marcador do evento e, com `matches` e sem marcador, precisa ser uma
expressão regular válida.

Limite conhecido: com lote, o app também avisa da ação que tira o alvo ou o
escopo do evento (a resposta a uma conversa, as ações de thread do GitHub, o
`github.review_comment` sem `owner`, `repo` e `pull`, o escopo da memória) fora
de um "para cada" sobre `{{event.items}}`. O catálogo não confere isso: a lista
mora no app, com exceções por parâmetro, e o esquema do template ainda não tem
"para cada". Template com lote deve entregar por uma ação que não lê alvo do
evento, como o `digest.deliver`.

Antes de abrir o PR, confira que não sobrou dado de empresa: nomes de pessoas,
times, canais, hosts e repositórios precisam ser genéricos.
