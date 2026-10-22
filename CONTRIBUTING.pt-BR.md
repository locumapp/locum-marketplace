# Como contribuir

[English](CONTRIBUTING.md)

Qualquer pessoa pode propor um template ou um pacote. Abra um PR que adiciona
ou muda um arquivo; a CI valida e quem mantém revisa. Tipos de conexão ainda
não são aceitos: o formato está abaixo para discussão, mas o validador recusa
arquivo em `connections/` até o app abri-los (veja o
[docs/connections-pending.md](docs/connections-pending.md)).

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
| `manifest` ou `package` | o corpo, abaixo |

Os esquemas estão em [`schemas/`](schemas/): `envelope.schema.json` e um por
kind.

## Tipos de conexão (ainda não aceitos)

`manifest` descreve o tipo como dado:

- `category`, `logo` (ou `null`), `color` (hex sem `#`);
- `methods`: `oauth` (com `scopes` opcional), `token` (com `header` ou `env`
  opcional, onde vai a credencial) ou `none`;
- `fields`: o que a instância pede além do nome, como um endereço;
- `server`, um destes:
  - `{"transport": "http", "url": "https://..."}`, com `headers` opcional;
  - `{"transport": "stdio", "image": "registro/nome@sha256:<64 hex>"}`;
  - `{"transport": "stdio", "package": {"registry": "npm", "name", "version", "bin", "lockfile"}}`,
    em que `lockfile` é o `package-lock.json` (versão 2 ou 3) de um projeto
    cuja única dependência é `name@version`. Toda entrada precisa de
    `integrity` e de `resolved` https, e nenhuma pode ter script de instalação.
  - `args` e `env` são opcionais em stdio. `${credential}` vai em `env` ou em
    header, nunca em `args`.
- `writeTools`: as ferramentas do servidor que escrevem fora da máquina;
- `hosts`, `aliases`, `packages` e `scopeKeys`, como nos manifestos do app.

Não entra: `command`, `npx`, `uvx` ou qualquer jeito de rodar script; imagem
sem digest; e os ids dos tipos embutidos no app (`github`, `slack`, `teams`,
`grafana`, `prelo`, `argocd` e os outros em
[`scripts/lib/rules.mjs`](scripts/lib/rules.mjs)).

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
repositórios ou todos os chats por deixar o campo vazio.

O que o gatilho lê precisa estar em `requisitos`: a conexão do tipo dele
(`x-reads-connection`) em `conexoes`, e o `server` de um `mcp-poll` em
`servidores`. Template só lê em `{{event.*}}` o que algum gatilho entrega:
`cron`, `schedule` e `manual` não trazem evento, e o template só com eles busca
pelas ferramentas dos passos. Template que precisaria de um evento que nenhum
gatilho entrega fica fora do catálogo até o app ter esse gatilho. Pacote pode
vir sem gatilho.

Antes de abrir o PR, confira que não sobrou dado de empresa: nomes de pessoas,
times, canais, hosts e repositórios precisam ser genéricos.
