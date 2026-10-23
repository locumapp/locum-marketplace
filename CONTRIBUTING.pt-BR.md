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
  `key`, `label`, `help` opcional, `format` (`url` ou `text`) e `required`;
- `servers`, com ao menos um de:
  - `remote`: `{"url": "https://..."}` para endereço fixo, ou
    `{"urlField": "<key>"}` quando a pessoa digita o endereço num campo `url`
    obrigatório. `headers` opcional, onde vai o `${credential}`;
  - `local`: `{"image": "registro/nome@sha256:<64 hex>"}` ou
    `{"package": {"registry": "npm", "name", "version", "bin", "lockfile"}}`,
    com `args` e `env` opcionais. Ainda não é aceito no catálogo: o app fixa
    servidor local numa release seguinte.
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
- `url` remota que não é https, traz usuário ou senha, tem placeholder
  (`${credential}` incluído, que pararia em log), escreve o host diferente da
  forma canônica (ASCII minúsculo, punycode, sem ponto final, o que pega
  homógrafo) ou aponta para endereço IP, `localhost`, nome sem ponto ou sufixo
  privado (`.local`, `.localhost`, `.localdomain`, `.internal`, `.intranet`,
  `.corp`, `.private`, `.home`, `.home.arpa`, `.lan`, `.test`, `.example`,
  `.invalid`). O mesmo vale para `hosts`.
- `${credential}` fora de header do servidor remoto ou do `env` do local, e
  qualquer outro placeholder em header.
- Tipo de gatilho, tipo de tracker ou ação que o núcleo não tem
  ([`scripts/lib/core-kinds.json`](scripts/lib/core-kinds.json) e os gatilhos
  do esquema de template), gatilho que lê outro tipo, e ação ou chave de escopo
  sem o id do tipo como prefixo.
- Host, apelido, pacote, tracker ou ação que outro tipo já usa, oficiais
  incluídos, e apelido igual ao id de outro tipo.
- Em servidor local: imagem sem digest ou com tag junto, flag de runtime que
  alarga o contêiner (`--privileged`, `-v`, `--network`...), variável que muda
  como o processo carrega código ou sai para a rede (`NODE_OPTIONS`,
  `NODE_TLS_REJECT_UNAUTHORIZED`, `ELECTRON_RUN_AS_NODE`, `SSLKEYLOGFILE`,
  `LD_*`, `DYLD_*`, `PATH`, `PYTHONPATH`, proxies...), e entrada de lockfile sem
  `integrity`, resolvida fora de `https://registry.npmjs.org/` ou com script
  de instalação.
- Os ids `locum` e `proprio`, que o app reserva, e id igual a apelido de tipo
  oficial (o app casa o nome do servidor primeiro pelo id).

### Ids oficiais

Os ids de [`scripts/lib/official-connections.json`](scripts/lib/official-connections.json)
(`github`, `slack`, `teams`, `grafana`, `prelo`, `argocd` e os outros que
vinham dentro do app) só quem mantém publica. O
[`.github/CODEOWNERS`](.github/CODEOWNERS) dá cada `connections/<id>.json`
deles aos donos do próprio CODEOWNERS, e o `npm run validate` falha quando um
falta ou tem outro dono. Os donos só seguram o merge quando a proteção da
`main` exigir review de code owner, o que ainda não está ligado (veja o
[docs/connections-pending.md](docs/connections-pending.md)). Nenhum outro tipo pode usar os hosts, apelidos, pacotes e trackers
listados para eles.

### Como o app vai receber, e as versões

Nada disto vale no app ainda: nenhuma versão publicada instala tipo de conexão
do catálogo. O app vai ler os tipos de conexão do índice assinado, o embutido
nele e o da rede (ADR 0018, fatia 2). Tipo instalado vai ficar preso ao commit
e ao `sha256` do arquivo. Quando `version` subir, o app vai mostrar a
atualização com o que mudou (fatia 5):

- mudança que não amplia o que o tipo pede (texto, ícone, campo, ferramenta de
  leitura) vai entrar sozinha, a não ser que a pessoa tenha desligado
  "atualizar sozinha" naquela conexão;
- mudança que amplia (host, escopo, método, ferramenta de escrita, imagem ou
  pacote novos) vai sempre esperar o aceite da pessoa, e a credencial nunca vai
  seguir para um host novo antes disso.

`minAppVersion` é obrigatório em tipo de conexão. Enquanto a release que lê
tipos de conexão não existe, qualquer `x.y.z` passa; depois dela, o piso vai
ser essa versão. Suba o valor quando o tipo usar método, leitor, tipo de
gatilho ou ação que app mais velho não tem: ele vai mostrar o tipo como
"precisa atualizar" e manter o instalado rodando.

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

Antes de abrir o PR, confira que não sobrou dado de empresa: nomes de pessoas,
times, canais, hosts e repositórios precisam ser genéricos.
