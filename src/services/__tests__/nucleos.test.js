const {
  pseudonimizar,
  reverterPseudonimizacao,
  segmentarRegistro,
  montarPromptAnalise,
  validarEvidencia,
  instanciasCandidatas,
  detectarTransicoes,
  evidenciasParaManter,
} = require('../nucleos');

describe('pseudonimização (LGPD)', () => {
  const paciente = { nome: 'Maria Fernanda Souza' };

  test('substitui o nome completo cadastrado por token', () => {
    const texto = 'Maria Fernanda Souza disse que estava cansada.';
    const resultado = pseudonimizar(texto, paciente);
    expect(resultado).not.toContain('Maria Fernanda Souza');
    expect(resultado).toContain('[ANALISANTE]');
  });

  test('substitui o primeiro nome sozinho, em qualquer lugar do texto', () => {
    const texto = 'Maria chegou atrasada hoje. Maria estava calada.';
    const resultado = pseudonimizar(texto, paciente);
    expect(resultado).not.toMatch(/\bMaria\b/);
    expect(resultado.match(/\[ANALISANTE\]/g)).toHaveLength(2);
  });

  test('não mexe em nomes parecidos mas diferentes (respeita borda de palavra)', () => {
    const texto = 'Mariana não é a mesma pessoa que Maria.';
    const resultado = pseudonimizar(texto, paciente);
    expect(resultado).toContain('Mariana');
  });

  test('critério de aceite: nenhum nome próprio do paciente sobrevive à pseudonimização', () => {
    const registroSemeadoComNomes =
      'Maria Fernanda Souza chegou dizendo que Maria não aguentava mais. ' +
      'Segundo Maria Fernanda Souza, o problema começou faz tempo.';
    const resultado = pseudonimizar(registroSemeadoComNomes, paciente);
    expect(resultado).not.toMatch(/Maria/);
  });

  test('reverte o token para o primeiro nome (uso só local)', () => {
    const pseudo = 'Hoje [ANALISANTE] chegou calma. [ANALISANTE] sorriu.';
    const revertido = reverterPseudonimizacao(pseudo, paciente);
    expect(revertido).toBe('Hoje Maria chegou calma. Maria sorriu.');
  });

  test('texto/paciente vazios não quebram', () => {
    expect(pseudonimizar('', paciente)).toBe('');
    expect(pseudonimizar('oi', null)).toBe('oi');
    expect(pseudonimizar(null, paciente)).toBeNull();
  });
});

describe('segmentarRegistro', () => {
  test('transcrição: só falas do analisante viram unidade, com contexto do analista anterior', () => {
    const conteudo = 'A: Como você está?\nP: Estou cansada.\nA: Cansada como?\nP: Não sei explicar.';
    const unidades = segmentarRegistro({ tipoRegistro: 'transcricao', conteudo });
    expect(unidades).toHaveLength(2);
    expect(unidades[0].texto).toBe('Estou cansada.');
    expect(unidades[0].contexto_anterior).toBe('Analista: Como você está?');
    expect(unidades[1].texto).toBe('Não sei explicar.');
  });

  test('anotação de sessão / estudo de caso: divide por parágrafos', () => {
    const conteudo = 'Primeiro parágrafo aqui.\n\nSegundo parágrafo, outra ideia.\n\nTerceiro.';
    const unidades = segmentarRegistro({ tipoRegistro: 'anotacao_sessao', conteudo });
    expect(unidades).toHaveLength(3);
    expect(unidades[1].texto).toBe('Segundo parágrafo, outra ideia.');
    expect(unidades[1].contexto_anterior).toBeNull();
  });

  test('conteúdo vazio devolve lista vazia', () => {
    expect(segmentarRegistro({ tipoRegistro: 'outro', conteudo: '' })).toEqual([]);
    expect(segmentarRegistro({ tipoRegistro: 'outro', conteudo: null })).toEqual([]);
  });
});

describe('montarPromptAnalise', () => {
  test('inclui os 4 núcleos e as regras de prudência no prompt de sistema', () => {
    const unidades = [{ indice: 0, texto: 'Estou com medo.', contexto_anterior: null }];
    const { promptSistema, promptUsuario } = montarPromptAnalise(unidades);
    expect(promptSistema).toMatch(/bem/);
    expect(promptSistema).toMatch(/mal/);
    expect(promptSistema).toMatch(/mau/);
    expect(promptSistema).toMatch(/bom/);
    expect(promptSistema).toMatch(/prudência/i);
    expect(promptSistema).not.toMatch(/diagnóstico do paciente|laudo|score diagnóstico/i);
    expect(promptUsuario).toContain('Estou com medo.');
  });
});

describe('validarEvidencia', () => {
  const textoOriginal = 'Sem isso eu vazo, entende? Não tem palavra.';

  test('aceita evidência cujo trecho existe literalmente no texto de origem', () => {
    const bruta = {
      trecho_literal: 'Sem isso eu vazo, entende?',
      nucleo: 'mal',
      indicador: 'P3',
      via: 'defensiva',
      intensidade: 3,
      confianca: 0.8,
      justificativa: 'angústia de dissolução',
    };
    const evidencia = validarEvidencia(bruta, textoOriginal);
    expect(evidencia).not.toBeNull();
    expect(evidencia.posicao_inicio).toBe(0);
    expect(evidencia.posicao_fim).toBe(bruta.trecho_literal.length);
  });

  test('descarta evidência com trecho inventado (não existe no texto original)', () => {
    const bruta = {
      trecho_literal: 'Isso nunca foi dito por ninguém aqui.',
      nucleo: 'mal',
      intensidade: 2,
      confianca: 0.7,
    };
    expect(validarEvidencia(bruta, textoOriginal)).toBeNull();
  });

  test('descarta núcleo inválido', () => {
    const bruta = { trecho_literal: 'Não tem palavra.', nucleo: 'inventado', intensidade: 1 };
    expect(validarEvidencia(bruta, textoOriginal)).toBeNull();
  });

  test('descarta intensidade fora de 0-3', () => {
    const bruta = { trecho_literal: 'Não tem palavra.', nucleo: 'mal', intensidade: 7 };
    expect(validarEvidencia(bruta, textoOriginal)).toBeNull();
  });

  test('confiança ausente vira 0.5 (padrão prudente)', () => {
    const bruta = { trecho_literal: 'Não tem palavra.', nucleo: 'mal', intensidade: 1 };
    const evidencia = validarEvidencia(bruta, textoOriginal);
    expect(evidencia.confianca).toBe(0.5);
  });
});

describe('transições', () => {
  test('instanciasCandidatas devolve as instâncias cujo conjunto contém os dois núcleos', () => {
    expect(instanciasCandidatas('bem', 'mal').sort()).toEqual(['ego', 'id']);
    expect(instanciasCandidatas('mau', 'bom').sort()).toEqual(['superego', 'superid']);
  });

  test('instanciasCandidatas(bem, bom) encontra ID topologicamente, mas detectarTransicoes ignora isso por serem diagonais', () => {
    // bem e bom aparecem juntos no conjunto de ID — mas a topologia do
    // modelo trata essa dupla como diagonal (só se comunica pelo Eu
    // nuclear), então detectarTransicoes nunca usa esse resultado bruto
    // para uma transição diagonal (ver teste abaixo).
    expect(instanciasCandidatas('bem', 'bom').sort()).toEqual(['id', 'superego']);
  });

  test('detecta transição simples entre núcleos vizinhos, com candidatas de instância', () => {
    const evidencias = [
      { nucleo: 'bem', indicador: 'N1', trecho_literal: 'quero sair mas não consigo', id: 'e1' },
      { nucleo: 'mal', indicador: 'P3', trecho_literal: 'não tem palavra', id: 'e2' },
    ];
    const transicoes = detectarTransicoes(evidencias);
    expect(transicoes).toHaveLength(1);
    expect(transicoes[0].de_nucleo).toBe('bem');
    expect(transicoes[0].para_nucleo).toBe('mal');
    expect(transicoes[0].diagonal_direta).toBe(false);
    expect(transicoes[0].gatilho_tipo).toBe('frustracao_desejo');
    expect(transicoes[0].gatilho_trecho).toBe('quero sair mas não consigo');
    expect(transicoes[0].instancias_candidatas.sort()).toEqual(['ego', 'id']);
  });

  test('sinaliza transição diagonal direta (bem->bom) como anômala, mediada pelo Eu nuclear', () => {
    const evidencias = [
      { nucleo: 'bem', indicador: 'N2', trecho_literal: 'sei o que eu quero', id: 'e1' },
      { nucleo: 'bom', indicador: 'A2', trecho_literal: 'senti uma paz completa', id: 'e2' },
    ];
    const transicoes = detectarTransicoes(evidencias);
    expect(transicoes).toHaveLength(1);
    expect(transicoes[0].diagonal_direta).toBe(true);
    expect(transicoes[0].asa_mediadora).toBe('eu_nuclear');
    expect(transicoes[0].instancias_candidatas).toEqual([]);
  });

  test('sinaliza transição diagonal direta (mal->mau) também', () => {
    const evidencias = [
      { nucleo: 'mal', indicador: 'P1', trecho_literal: 'tudo se desconecta', id: 'e1' },
      { nucleo: 'mau', indicador: 'V1', trecho_literal: 'fiz de propósito', id: 'e2' },
    ];
    const transicoes = detectarTransicoes(evidencias);
    expect(transicoes[0].diagonal_direta).toBe(true);
  });

  test('não gera transição quando o núcleo se repete', () => {
    const evidencias = [
      { nucleo: 'bem', trecho_literal: 'a', id: 'e1' },
      { nucleo: 'bem', trecho_literal: 'b', id: 'e2' },
    ];
    expect(detectarTransicoes(evidencias)).toHaveLength(0);
  });

  test('eu_nuclear não entra na sequência de transições', () => {
    const evidencias = [
      { nucleo: 'bem', trecho_literal: 'a', id: 'e1' },
      { nucleo: 'eu_nuclear', trecho_literal: 'indizível', id: 'e2' },
      { nucleo: 'mal', trecho_literal: 'b', id: 'e3' },
    ];
    const transicoes = detectarTransicoes(evidencias);
    expect(transicoes).toHaveLength(1);
    expect(transicoes[0].de_nucleo).toBe('bem');
    expect(transicoes[0].para_nucleo).toBe('mal');
  });
});

describe('idempotência', () => {
  test('preserva evidências já validadas/rejeitadas/reclassificadas ao reanalisar', () => {
    const existentes = [
      { id: '1', status_validacao: 'pendente' },
      { id: '2', status_validacao: 'confirmada' },
      { id: '3', status_validacao: 'rejeitada' },
      { id: '4', status_validacao: 'reclassificada' },
      { id: '5', status_validacao: 'pendente' },
    ];
    const mantidas = evidenciasParaManter(existentes);
    expect(mantidas.map((e) => e.id).sort()).toEqual(['2', '3', '4']);
  });

  test('lista vazia/indefinida não quebra', () => {
    expect(evidenciasParaManter([])).toEqual([]);
    expect(evidenciasParaManter(undefined)).toEqual([]);
  });
});
