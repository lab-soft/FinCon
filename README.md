# FinCon — controle financeiro da CCBV

App web (HTML + JavaScript puros, sem build) para montar os resumos econômicos a partir dos extratos bancários
(originais ou consolidados), gerar os **vales**, controlar **bancos** e itens **a justificar** e emitir os
relatórios das abas 8–14 da planilha "Secretaria Evolution" (Caixa B/C frente e verso, folhas pessoais, livro
caixa, vale eletrônico).

- **Demonstração** (dados só no seu navegador): abra `index.html?demo`.
- **Produção**: Firebase (login por e-mail/senha + Firestore). Os extratos são lidos no navegador; só os
  lançamentos interpretados vão para a base.

## Lugares e perfis
O app atende **vários lugares independentes** (cada um com suas pessoas, contas, códigos, saldos, vales e relatórios).
- **adm** (administrador, global): cria os lugares e os primeiros logins; escolhendo um lugar no alto da tela, tem o
  acesso completo a ele. O primeiro usuário do sistema é o administrador.
- **cl** (local): acesso total ao próprio lugar — importa a planilha da secretaria e os extratos, classifica, gera os
  vales do mês (rateio do Caixa C e ajustes), controla bancos e itens a justificar, fecha os meses, imprime os
  relatórios e cria os logins de cl e residentes do lugar.
- **residente** (local): envia e classifica os próprios extratos e vê os próprios vales.
- **cr** (global, só consulta): vê a conferência e os relatórios de cada lugar e o **consolidado** de todos.

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
4. **Encerrar o mês** (em Vales) guarda o total a justificar daquele mês e trava vales, bancos e itens a justificar
   do mês; "Reabrir o mês" desfaz.

Outras telas: **Início** mostra os extratos pendentes (conta × mês não contabilizado ou com saldo que não encadeia) e,
quando a conferência não fecha, de onde vem a diferença (caixa B/C e contas com saldo diferente do extrato).
**Membros**: o cl inclui membros da casa e muda o status (sem acesso / residente / cl). **Justificar**: exclusão de
vários itens de uma vez. **Relatórios**: exportação para xlsx (abas à escolha; 8–11 marcadas) e relatório
**quadrimestral** (por lugar ou consolidado).

## Configuração do Firebase (uma vez)
1. Crie um projeto no [console do Firebase](https://console.firebase.google.com) (plano Spark, gratuito).
2. Authentication → Método de login → ative **E-mail/senha**. Em Configurações → Domínios autorizados, inclua
   `lab-soft.github.io`.
3. Firestore Database → criar (região `southamerica-east1`) → Regras: cole o conteúdo de `firestore.rules`.
4. Configurações do projeto → Seus apps → app da Web → copie a configuração para `js/firebase-config.js`.
5. Abra o app, crie a conta do administrador (Entrar → "Primeiro acesso do administrador") e confirme. Em Lugares,
   crie os lugares e os primeiros logins de cl; o cl importa a planilha da secretaria e cria os logins dos residentes.

## Coleções do Firestore
`users` (perfil, lugar e sigla) · `lugares` · `config/{lugar}` (pessoas, contas, códigos, saldo inicial, orçamento) · `lancamentos` ·
`saldos` (saldo real do extrato por conta/mês) · `vales` · `justificar` · `bancos` · `meses` (fechamentos) — todos com o
campo `lugar`.

## Estrutura
`index.html` · `css/style.css` · `js/app.js` (telas) · `js/logic.js` (regras, geração, conferência) ·
`js/parsers.js` (leitores de extrato) · `js/reports.js` (abas 8–14) · `js/importer.js` (planilha da secretaria) ·
`js/data-firebase.js` / `js/data-demo.js` (dados) · `firestore.rules` · `test/` (testes no navegador: `test/index.html`).

Bibliotecas carregadas de CDN quando necessárias: SheetJS 0.20.3, pdf.js 4.0.379, Firebase 10.12.2.
