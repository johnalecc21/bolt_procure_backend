import { bestMatch, normalizeName, similarity } from './name-matching';
import { parseOnuXml } from './onu.service';
import { parseSdnCsv } from './ofac.service';

describe('name matching', () => {
  it('normalizes accents, case and punctuation', () => {
    expect(normalizeName('  Compañía Andina, S.A.S. ')).toBe(
      'COMPANIA ANDINA S A S',
    );
  });

  it('scores identical strings 1 and unrelated ones low', () => {
    expect(similarity('ACME', 'ACME')).toBe(1);
    expect(similarity('ACME CORP', 'ZETA LOGISTICA')).toBeLessThan(0.3);
  });

  it('matches exact, contained and near-identical names', () => {
    const list = ['BANCO DELTA INTERNACIONAL', 'JUAN PEREZ GOMEZ'];
    expect(bestMatch('Banco Delta Internacional S.A.', list).matched).toBe(
      true,
    );
    expect(bestMatch('Juan Perez Gomes', list)).toMatchObject({
      matched: true,
    });
    expect(bestMatch('Cloudsphere Technologies', list).matched).toBe(false);
  });

  it('never matches an empty name', () => {
    expect(bestMatch('   ', ['ANY']).matched).toBe(false);
  });
});

describe('parseSdnCsv', () => {
  it('takes the name column and skips -0- placeholders', () => {
    const csv = [
      '36,"AEROCARIBBEAN AIRLINES",-0- ,"CUBA"',
      '173,"-0-",-0-',
      '306,"BANCO NACIONAL DE CUBA",-0-',
    ].join('\n');
    expect(parseSdnCsv(csv)).toEqual([
      'AEROCARIBBEAN AIRLINES',
      'BANCO NACIONAL DE CUBA',
    ]);
  });
});

describe('parseOnuXml', () => {
  it('extracts individuals, entities and aliases', () => {
    const xml = `<CONSOLIDATED_LIST>
      <INDIVIDUALS>
        <INDIVIDUAL><DATAID>1</DATAID><FIRST_NAME>ABDUL</FIRST_NAME><SECOND_NAME>RAHMAN</SECOND_NAME><THIRD_NAME/>
          <INDIVIDUAL_ALIAS><QUALITY>Good</QUALITY><ALIAS_NAME>Abu Test</ALIAS_NAME></INDIVIDUAL_ALIAS>
        </INDIVIDUAL>
      </INDIVIDUALS>
      <ENTITIES>
        <ENTITY><DATAID>2</DATAID><FIRST_NAME>AL-EXAMPLE FOUNDATION</FIRST_NAME>
          <ENTITY_ALIAS><ALIAS_NAME>Example Charity</ALIAS_NAME></ENTITY_ALIAS>
        </ENTITY>
      </ENTITIES>
    </CONSOLIDATED_LIST>`;
    expect(parseOnuXml(xml)).toEqual([
      'ABDUL RAHMAN',
      'ABU TEST',
      'AL EXAMPLE FOUNDATION',
      'EXAMPLE CHARITY',
    ]);
  });
});
