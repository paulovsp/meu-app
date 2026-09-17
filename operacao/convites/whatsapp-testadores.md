# Convite de teste pelo WhatsApp

Para quem o Paulo só tem o número. A cortesia é amarrada ao e-mail cadastrado
antes de a pessoa criar a conta (migration 0103), então a mensagem pede o
e-mail primeiro. Quando a pessoa responder, registrar com:

```bash
curl -s -X POST "$EXPO_PUBLIC_SUPABASE_URL/functions/v1/enviar-convite-testador" -H "Content-Type: application/json" -H "x-convite-secret: $CONVITE_TESTADOR_SECRET" -H "apikey: $EXPO_PUBLIC_SUPABASE_ANON_KEY" -d '{"emails":["EMAIL"],"validoAte":"2026-12-31"}'
```

(sem `previaPara`, isso registra e manda o e-mail de boas-vindas à pessoa.)

## Mensagem (colar no WhatsApp)

Oi, [nome]! Tudo bem?

Lancei o Dr.Sig, um app para quem atende em psicoterapia: agenda, fichas, registro das sessões, cobrança e recibos, tudo num lugar só, no celular. Ele acabou de chegar à Play Store, e nesta primeira fase estou convidando um grupo pequeno de colegas para usar de verdade e me dizer o que funciona e o que não funciona.

O convite é acesso completo e gratuito até 31/12/2026, com os créditos de IA inclusos (transcrição, relatórios e busca). Nada é cobrado e não precisa cadastrar cartão.

Só preciso de uma coisa: me manda o e-mail que você vai usar no app. A cortesia fica amarrada a ele, e a conta já nasce liberada quando você se cadastrar com esse e-mail. Assim que eu registrar, você recebe um e-mail com o passo a passo.

Enquanto isso, dá para conhecer o app sem criar conta: https://play.google.com/store/apps/details?id=br.com.drsig.app (na tela de entrada, "Conhecer o app sem criar conta" abre um consultório fictício, o do Freud).

Uma coisa a mais: o app tem um programa de indicações, e ele já vale para quem entra agora. Em Meu Perfil você encontra o seu código de indicação (seis letras e números) com um botão de compartilhar. Uma colega que criar a conta digitando o seu código no campo "Código de indicação" fica vinculada a você, e cada indicação ativa dá 10% de desconto na sua mensalidade; dez indicações deixam a assinatura gratuita. Durante a cortesia nada é cobrado, então o desconto passa a valer a partir de 2027, se você decidir assinar. As indicações feitas desde já continuam contando.

## Depois que a pessoa mandar o e-mail

Registrar (comando acima) e responder:

Pronto, [nome]: o acesso já está liberado para [e-mail]. Chegou um e-mail com o passo a passo. É criar a conta com esse mesmo e-mail e usar. Qualquer coisa que notar, me escreve por aqui ou responde o e-mail.
