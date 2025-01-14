import request from '../../services/request';
import { stripHashPrefix } from '../../utils/stripHashPrefix';
import { buildTransactionServiceUrl } from '../../services/transaction-apis';
import { BLOCKCHAINS, isTestChain } from '../../constants/blockchains';
import { TransactionData } from '../../models/transactionData';
import { TRANSACTION_APIS, TRANSACTION_ID_PLACEHOLDER } from '../../constants/api';
import { ExplorerAPI, ExplorerURLs, IParsingFunctionAPI } from '../../models/explorers';
import CONFIG from '../../constants/config';
import { SupportedChains } from '../../constants/supported-chains';

const MAIN_API_BASE_URL = 'https://api.etherscan.io/api?module=proxy';
const TEST_API_BASE_URL = 'https://api-ropsten.etherscan.io/api?module=proxy';
const serviceURL: ExplorerURLs = {
  main: `${MAIN_API_BASE_URL}&action=eth_getTransactionByHash&txhash=${TRANSACTION_ID_PLACEHOLDER}`,
  test: `${TEST_API_BASE_URL}&action=eth_getTransactionByHash&txhash=${TRANSACTION_ID_PLACEHOLDER}`
};

// TODO: use tests/explorers/mocks/mockEtherscanResponse as type
async function parsingFunction ({ jsonResponse, chain, key, keyPropertyName }: IParsingFunctionAPI): Promise<TransactionData> {
  const getBlockByNumberServiceUrls: Partial<ExplorerAPI> = {
    serviceURL: {
      main: `${MAIN_API_BASE_URL}&action=eth_getBlockByNumber&boolean=true&tag=${TRANSACTION_ID_PLACEHOLDER}`,
      test: `${TEST_API_BASE_URL}&action=eth_getBlockByNumber&boolean=true&tag=${TRANSACTION_ID_PLACEHOLDER}`
    }
  };
  const getBlockNumberServiceUrls: Partial<ExplorerAPI> = {
    serviceURL: {
      main: `${MAIN_API_BASE_URL}&action=eth_blockNumber`,
      test: `${TEST_API_BASE_URL}&action=eth_blockNumber`
    }
  };

  function parseEtherScanResponse (jsonResponse, block): TransactionData {
    const data = jsonResponse.result;
    const time: Date = new Date(parseInt(block.timestamp, 16) * 1000);
    const issuingAddress: string = data.from;
    const remoteHash = stripHashPrefix(data.input, BLOCKCHAINS.ethmain.prefixes); // remove '0x'

    // The method of checking revocations by output spent do not work with Ethereum.
    // There are no input/outputs, only balances.
    return {
      remoteHash,
      issuingAddress,
      time,
      revokedAddresses: []
    };
  }

  async function getEtherScanBlock (jsonResponse, chain: SupportedChains): Promise<any> {
    const data = jsonResponse.result;
    const blockNumber = data.blockNumber;
    const requestUrl = buildTransactionServiceUrl({
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      explorerAPI: {
        ...getBlockByNumberServiceUrls,
        key,
        keyPropertyName
      } as ExplorerAPI,
      transactionId: blockNumber,
      isTestApi: isTestChain(chain)
    });

    try {
      const response = await request({ url: requestUrl });
      const responseData = JSON.parse(response);
      const blockData = responseData.result;

      await checkEtherScanConfirmations(chain, blockNumber);
      return blockData;
    } catch (err) {
      throw new Error('Unable to get remote hash');
    }
  }

  async function checkEtherScanConfirmations (chain: SupportedChains, blockNumber: number): Promise<number> {
    const requestUrl: string = buildTransactionServiceUrl({
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      explorerAPI: {
        ...getBlockNumberServiceUrls,
        key,
        keyPropertyName
      } as ExplorerAPI,
      isTestApi: isTestChain(chain)
    });

    let response: string;
    try {
      response = await request({ url: requestUrl });
    } catch (err) {
      // TODO: not tested?
      throw new Error('Unable to get remote hash');
    }

    const responseData = JSON.parse(response);
    const currentBlockCount: number = responseData.result;

    if (currentBlockCount - blockNumber < CONFIG.MininumConfirmations) {
      // TODO: not tested
      throw new Error('Not enough');
    }
    return currentBlockCount;
  }

  // Parse block to get timestamp first, then create TransactionData
  const blockResponse = await getEtherScanBlock(jsonResponse, chain);
  return parseEtherScanResponse(jsonResponse, blockResponse);
}

export const explorerApi: ExplorerAPI = {
  serviceURL,
  serviceName: TRANSACTION_APIS.etherscan,
  parsingFunction,
  priority: -1
};
