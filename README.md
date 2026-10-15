# FinCon — controle financeiro da CCBV

App web (HTML + JavaScript puros, sem build) para montar os resumos econômicos a partir dos extratos bancários
(originais ou consolidados), gerar os **vales**, controlar **bancos** e itens **a justificar** e emitir os
relatórios das abas 8–14 da planilha "Secretaria Evolution" (Caixa B/C frente e verso, folhas pessoais, livro
caixa, vale eletrônico).

- **Demonstração** (dados só no seu navegador): abra `index.html?demo`.
- **Produção**: Firebase (login por e-mail/senha + Firestore). Os extratos são lidos no navegador; só os
  lançamentos interpretados vão para a base.

## Perfis
- **secretaria**: importa a planilha da secretaria e os extratos de todos, classifica, gera os vales do mês
  (com rateio do Caixa C e ajustes), controla bancos e itens a justificar, fecha os meses e imprime os relatórios.
- **residente**: envia e classifica os próprios extratos e vê os próprios vales.

## Extratos aceitos
PDF do Itaú · planilha exportada do Itaú (.xls/.xlsx, com anotações nas colunas à direita) · CSV da conta Nubank ·
fatura do cartão Nubank (date/title/amount) · planilhas no formato do modelo consolidado (uma aba por mês).

## Como funciona o mês (como na planilha da secretaria)
1. Lançamentos de extrato por pessoa/conta, com Tipo1 (código da aba 1), caixa (B, C ou "justificar") e
   discriminação. Sem classificação = "???" (entra provisoriamente como DV "DESCONHECIDO" / RR "NÃO IDENTIFICADO").
2. **Gerar vales do mês**: soma por pessoa, caixa, E/S e código; uma linha por conta na aba BANCOS (entradas e
   saídas do mês); itens a justificar; ajustes ("AJUSTE CARTÃO" = compras − fatura paga; "AJUSTE SALDO BANCÁRIO"
   quando o saldo inicial do extrato difere do saldo da conta); rateio do déficit do Caixa C entre os moradores
   (B/S "PS" e C/E "CO", "PENSÃO+CONTRIB. LABORES").
3. **Conferência** (abas 9 e 11, célula N1): saldo final de cada caixa = dinheiro + bancos + a justificar.
4. **Fechar o mês** em Justificar guarda o total a justificar daquele mês.

## Configuração do Firebase (uma vez)
1. Crie um projeto no [console do Firebase](https://console.firebase.google.com) (plano Spark, gratuito).
2. Authentication → Método de login → ative **E-mail/senha**. Em Configurações → Domínios autorizados, inclua
   `lab-soft.github.io`.
3. Firestore Database → criar (região `southamerica-east1`) → Regras: cole o conteúdo de `firestore.rules`.
4. Configurações do projeto → Seus apps → app da Web → copie a configuração para `js/firebase-config.js`.
5. Abra o app, crie a conta da secretaria (Entrar → "Primeiro acesso da secretaria") e confirme "Sou a secretaria".
   Depois, em Configuração, importe a planilha da secretaria e crie os logins dos residentes.

## Coleções do Firestore
`users` (perfil e sigla) · `config/geral` (pessoas, contas, códigos, saldo inicial, orçamento) · `lancamentos` ·
`saldos` (saldo real do extrato por conta/mês) · `vales` · `justificar` · `bancos` · `meses` (fechamentos).

## Estrutura
`index.html` · `css/style.css` · `js/app.js` (telas) · `js/logic.js` (regras, geração, conferência) ·
`js/parsers.js` (leitores de extrato) · `js/reports.js` (abas 8–14) · `js/importer.js` (planilha da secretaria) ·
`js/data-firebase.js` / `js/data-demo.js` (dados) · `firestore.rules` · `test/` (testes no navegador: `test/index.html`).

Bibliotecas carregadas de CDN quando necessárias: SheetJS 0.20.3, pdf.js 4.0.379, Firebase 10.12.2.
