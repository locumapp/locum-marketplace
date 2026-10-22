# locum-marketplace

Catálogo público do [Locum](https://locumapp.github.io): tipos de conexão,
modelos de automação e pacotes que qualquer pessoa pode propor.

## O que mora aqui

- `conexoes/`: manifestos de tipo de conexão. Cada manifesto é só dado: o
  servidor MCP com versão fixada (imagem com digest ou pacote com lockfile), os
  métodos de autenticação, os campos da instância e o que o tipo escreve fora.
- `modelos/`: modelos de automação, com os nós visíveis.
- `pacotes/`: pacotes exportados do Locum, já limpos de dado de empresa.

Nada aqui é código executado pelo app. Um manifesto que peça para rodar script
baixado é recusado.

## Como o app usa

O app só aceita o índice assinado por quem mantém este repositório (Ed25519).
Item instalado fica preso ao commit e ao hash que tinha, e só muda quando a
pessoa aceita a atualização. A tela de instalação mostra o que o item pede:
comando ou imagem, hosts, métodos, escopos e ferramentas de escrita.

## Como propor um item

Abra um PR com o arquivo na pasta certa. A CI confere o esquema e quem mantém
revisa. O formato de cada pasta está sendo fechado; até lá, abra uma issue
descrevendo o que quer publicar.
