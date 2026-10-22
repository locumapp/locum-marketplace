# locum-marketplace

[English](README.md)

Catálogo público do [Locum](https://locumapp.github.io): tipos de conexão,
templates de automação e pacotes que qualquer pessoa pode propor.

## O que mora aqui

- `connections/`: manifestos de tipo de conexão. Cada manifesto é só dado: o
  servidor MCP (um endereço https remoto, uma imagem fixada por digest ou um
  pacote npm fixado pelo lockfile), os métodos de autenticação, os campos da
  instância e as ferramentas que escrevem fora da máquina.
- `templates/`: templates de automação, com os nós visíveis.
- `packages/`: pacotes exportados do Locum, já limpos de dado de empresa.

Cada item é um arquivo JSON, `<pasta>/<id>.json`, com um envelope comum:
`kind`, `id`, `version`, `name`, `description`, `tags` opcionais e o corpo
(`manifest` para conexão, `package` para template e pacote). Os esquemas
ficam em [`schemas/`](schemas/), e o [CONTRIBUTING.pt-BR.md](CONTRIBUTING.pt-BR.md)
explica cada campo.

O template pode declarar também `minAppVersion`, a versão mais antiga do Locum
que o instala, como `x.y.z` (só números, como `0.2.0`). Declare quando o
template usa algo que só existe a partir de uma versão do app: um nó novo, um
campo novo num nó, um tipo de gatilho novo. Deixe de fora quando o template só
usa o que todo app que lê o índice já conhece. O índice leva o campo como veio;
o app mais velho que a versão lista o template marcado como "precisa atualizar"
e recusa a instalação. Versões do app anteriores ao campo o ignoram, então
declarar não esconde o template delas.

Nada aqui é código executado pelo app. Item que peça para rodar comando ou
script baixado é recusado. `npx` e `uvx` nunca são aceitos: servidor local é
imagem fixada por digest ou pacote npm fixado pelo lockfile.

Todo texto que aparece para a pessoa (nome, rótulo, descrição) é traduzido:
cada campo de texto traz uma entrada por idioma (`en`, `pt-BR`), e o app mostra
a do idioma escolhido.

## Como o app usa

A CI publica o `index.json` e a assinatura Ed25519 dele, `index.json.sig`, no
branch `index` a cada push na `main`:

- índice: `https://raw.githubusercontent.com/locumapp/locum-marketplace/index/index.json`
- item: `https://raw.githubusercontent.com/locumapp/locum-marketplace/<commit>/<path>`

O índice lista cada item com o commit de onde saiu, a hora do commit
(`committedAt`, em segundos), o sha256 do arquivo e o que o item pede. O app
vai guardar uma lista de chaves públicas confiáveis e só aceitar índice
assinado por uma delas. Hoje a lista tem uma chave (SPKI DER em base64, também
em [`keys/index-signing.pub`](keys/index-signing.pub)):

```
MCowBQYDK2VwAyEAkZEZ6pKsyVb9KBFvI56NOo6nsaldB4j3cS/ds9Y/shM=
```

O app vai recusar índice com `committedAt` menor que o do índice que já tem,
para que um índice assinado antigo não volte a ser servido. Item instalado vai
ficar preso ao commit e ao hash que tinha, e só mudar quando a pessoa aceitar a
atualização. A tela de instalação vai mostrar o que o item pede: servidor ou
imagem, hosts, métodos, escopos e ferramentas de escrita numa conexão;
conexões, servidores, provedores e ações num template ou pacote.

## Como propor um item

Abra um PR com o arquivo na pasta certa. A CI roda o validador e quem mantém
revisa. Veja o [CONTRIBUTING.pt-BR.md](CONTRIBUTING.pt-BR.md).
