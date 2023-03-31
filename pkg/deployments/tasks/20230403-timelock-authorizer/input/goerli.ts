import { DAY } from '@balancer-labs/v2-helpers/src/time';
import Task, { TaskMode } from '../../../src/task';
import { DelayData, RoleData } from './types';
import { ANY_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

const EVERYWHERE = ANY_ADDRESS;

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY, 'goerli');

const BalancerTokenAdmin = new Task('20220325-balancer-token-admin', TaskMode.READ_ONLY, 'goerli');
const GaugeController = new Task('20220325-gauge-controller', TaskMode.READ_ONLY, 'goerli');
const VotingEscrowDelegationProxy = new Task('20220325-ve-delegation', TaskMode.READ_ONLY, 'goerli');
const SmartWalletChecker = new Task('20220420-smart-wallet-checker', TaskMode.READ_ONLY, 'goerli');

const DAO_MULTISIG = '0x171C0fF5943CE5f133130436A29bF61E26516003';

// Start: block that contains the transaction that deployed the `TimelockAuthorizer`.
// <!-- markdown-link-check-disable --> etherscan.io/tx/0x20eb23f4393fd592240ec788f44fb9658cc6ef487b88398e9b76c910294c4eae <!-- markdown-link-check-enable -->
// End: close to the current block at the time the `TimelockAuthorizerMigrator` is deployed.
// It is expected that no roles were granted to the old authorizer after it.
export const TRANSITION_START_BLOCK = 8745337;
export const TRANSITION_END_BLOCK = 8745437;

export const Root = DAO_MULTISIG;

// Permission fetched from TheGraph
// <!-- markdown-link-check-disable --> thegraph.com/hosted-service/subgraph/balancer-labs/balancer-authorizer-goerli <!-- markdown-link-check-enable -->
const theGraphRoles = [
  {
    id: '0x014d6b43e6c60cd9f1183053447be80d6c6ca5d245f2fd594f23289f1a847769',
    account: '0x7b9b6f094dc2bd1c12024b0d9cc63d6993be1888',
    action: {
      id: '0xc149e88b59429ded7f601ab52ecd62331cac006ae07c16543439ed138dcb8d34',
    },
    txHash: '0x737deb63336a007f7283437e6c05e7877ad1c65554f2002a7dfa8bed63e3301b',
  },
  {
    id: '0x04f94363f02b5db6aeb10a0e62e5fc57ad07ea9259834c376a4540c9e1e2e3f4',
    account: '0x2122a7fcc2eebf59cdf532ebfd197d56343e34a0',
    action: {
      id: '0x193789981465ebf36f4c335742c2f7d5eb973fae73b724abe4efb1677f374ba7',
    },
    txHash: '0x3d2ac5880a7cd6d7ab2076c4400a6e043e5b81049f056492a3330e9c389ce6c5',
  },
  {
    id: '0x0743ef051aebbb6885c970d0c62a5ac24265f95e8b255e560aa265470d14dee0',
    account: '0x03f1ab8b19bce21eb06c364aec9e40322572a1e9',
    action: {
      id: '0xeba777d811cd36c06d540d7ff2ed18ed042fd67bbf7c9afcf88c818c7ee6b498',
    },
    txHash: '0x79102fe6eb2ddddbd19801b99e1438635d14196806420150115ecf6f4e9ccb22',
  },
  {
    id: '0x10016c9d5ccf96c66c52caee4c2343862117814504416076c21e887d7166368f',
    account: '0x4b1635c7d3d1fc353298f92083e82df69e1e9158',
    action: {
      id: '0xeba777d811cd36c06d540d7ff2ed18ed042fd67bbf7c9afcf88c818c7ee6b498',
    },
    txHash: '0x1c2c959e93480d6d682f0f2a68b244043cc19a377566ad6791f7c0430448d4d9',
  },
  {
    id: '0x10faf9a9ea1f2a22413875f3d0a713aab3ef1d2bc9f6d105c322b638e6a45697',
    account: '0x3babebfd684506a5b47701ee231a53427ad413ef',
    action: {
      id: '0x15b9b1632a6b213be2605774ec758d803ccbe6ccc63890b9c8d9db4919b52832',
    },
    txHash: '0x1732a69c44dfaf337a767f0e7b5386344fa3178b9c694553a6ba6ae8e0f3a6c4',
  },
  {
    id: '0x185a884efb824614a0da651f172bddbf246757a33c08768fe6aed7edb50443fd',
    account: '0xe0a171587b1cae546e069a943eda96916f5ee977',
    action: {
      id: '0x3ff9e4de013546219b242e84ec6504fa5fbf38a304d44867952f64938a514525',
    },
    txHash: '0x3d2ac5880a7cd6d7ab2076c4400a6e043e5b81049f056492a3330e9c389ce6c5',
  },
  {
    id: '0x1c16b69df1b7fc87a4bdbefec7fc5b1649282c495479c2a685410c8e68de5639',
    account: '0x4b1635c7d3d1fc353298f92083e82df69e1e9158',
    action: {
      id: '0x0014a06d322ff07fcc02b12f93eb77bb76e28cdee4fc0670b9dec98d24bbfec8',
    },
    txHash: '0xb06ae9efea790d6ea8e8a8fcde33ce5d683ffb9450090d374910372b72e4da89',
  },
  {
    id: '0x1f388610e550ebc9f4be4fd4d59ab08100d42170d88f28dbcdb798d980122956',
    account: '0x3babebfd684506a5b47701ee231a53427ad413ef',
    action: {
      id: '0xce5365a1997f2bf34c1961ac02d4bf6ad23b9f44d4c14a217a4df348b0dfd4cf',
    },
    txHash: '0x1732a69c44dfaf337a767f0e7b5386344fa3178b9c694553a6ba6ae8e0f3a6c4',
  },
  {
    id: '0x205ddf486d45ab2a620b73293e458f5ee32cd109bfaa9e6ddc0c21aac4c32b7a',
    account: '0x4b1635c7d3d1fc353298f92083e82df69e1e9158',
    action: {
      id: '0x7b8a1d293670124924a0f532213753b89db10bde737249d4540e9a03657d1af0',
    },
    txHash: '0xd0fd95e43b840c7b10d36caf0bf79170a0d68bc376cb9dc1af67b82c20783438',
  },
  {
    id: '0x206d8ddb0c83b42990ff0c4260dcfd50da2684d2f64ec2ba07e93ff6f3f3b990',
    account: '0x4b1635c7d3d1fc353298f92083e82df69e1e9158',
    action: {
      id: '0xc149e88b59429ded7f601ab52ecd62331cac006ae07c16543439ed138dcb8d34',
    },
    txHash: '0x91e1e1647943eb3a7f43f41e3ab2b7219cf8fd9d883e212e79f0700090805316',
  },
  {
    id: '0x21856cc9d78b448bf7bdfab9c60631216d1f5e99145360271b94a71a13f4af3c',
    account: '0x4b1635c7d3d1fc353298f92083e82df69e1e9158',
    action: {
      id: '0x1282ab709b2b70070f829c46bc36f76b32ad4989fecb2fcb09a1b3ce00bbfc30',
    },
    txHash: '0xf8d4fb2126f33fc517b9950ccd199e6ba658631e0abfa0e10d9d5545741e54a5',
  },
  {
    id: '0x32417df699fd50085c7bf16f0d4544e738cb5e75825e202be7ab394affd16830',
    account: '0x3babebfd684506a5b47701ee231a53427ad413ef',
    action: {
      id: '0x809e834888be70d2521a7587ac1e1a90868b67632c47eb9ad77aa1181d33adba',
    },
    txHash: '0x1732a69c44dfaf337a767f0e7b5386344fa3178b9c694553a6ba6ae8e0f3a6c4',
  },
  {
    id: '0x33f26ed25881b07356e4c072e5b0ce101a6e51051ba674fcdaa1c16de49d89ce',
    account: '0x2fb8ad26fadc971464a17407e9213d1a22befc8a',
    action: {
      id: '0x1282ab709b2b70070f829c46bc36f76b32ad4989fecb2fcb09a1b3ce00bbfc30',
    },
    txHash: '0xe5d296c5e1f261b47268aebf82b65a2ea182d6101e37b196a2e1ad787518e727',
  },
  {
    id: '0x388c8e530d792c8aac92bc84056d618f9ad35d28961ea2a97947bc9ccc1c9e8b',
    account: '0xe0a171587b1cae546e069a943eda96916f5ee977',
    action: {
      id: '0xe82fca7fd9eb6591902d7a05b72294a683fbe649176226b09bed677446546634',
    },
    txHash: '0x3d2ac5880a7cd6d7ab2076c4400a6e043e5b81049f056492a3330e9c389ce6c5',
  },
  {
    id: '0x392e6f6471a91f811617b0b5261ee252799d6dc67f39bc600a8da8a29655c822',
    account: '0x3b1836c09fdae0a7c2848f99b2584aebd6a36876',
    action: {
      id: '0x38f12558087095621293389b35508390a03d17855b55b2394ce67b3c47d4463d',
    },
    txHash: '0xcf396873b2175efb35faf53f90818464e87c0b8ddcb874b5a4286202bbd080fe',
  },
  {
    id: '0x3993bfc9ad32311cad30666299cc4c0b0c53f7793be011cdda5ffa0b7708f6a6',
    account: '0x00e695aa8000df01b8dc8401b4c34fba5d56bbb2',
    action: {
      id: '0x1282ab709b2b70070f829c46bc36f76b32ad4989fecb2fcb09a1b3ce00bbfc30',
    },
    txHash: '0xc3ab135a662ddb28735102c43439aca5840176d53ed3fe158fdf0c45aa3e9c27',
  },
  {
    id: '0x3a65ddabd035cf6f76da882ef7dfde157a4b671ac0195135a7117f001d89045a',
    account: '0x10a19e7ee7d7f8a52822f6817de8ea18204f2e4f',
    action: {
      id: '0xfa01325e2a9c77cda6b403aebfca7b8308d967df009e17ac6b42ba6d18088cfd',
    },
    txHash: '0x0dd4c07bdba9d4ae977e43ee2d784722a1f5b26c4547379d29e708460123658c',
  },
  {
    id: '0x3cfd33aa518368d73cb18814c743beb29903c956f11624c58e5a42576573a089',
    account: '0x3babebfd684506a5b47701ee231a53427ad413ef',
    action: {
      id: '0x6b5e3750e9adcbd4a75428ed3fc6d2d3fc8a52866660ad3778d3f8c33108edff',
    },
    txHash: '0x112dc09e4819b11e8d768b7749b3c81ebd0e1cf042e5933dbba4e67ecdc14f42',
  },
  {
    id: '0x3e00b84d7fa819cf0e99298fc991900fa8377bee3b6542272524af0849d8d894',
    account: '0x3b1836c09fdae0a7c2848f99b2584aebd6a36876',
    action: {
      id: '0xf0a77343972ffaea6782864c7880d1cee9576736637f7702cb0a922223208118',
    },
    txHash: '0x70b3f9ff51e827da3b3369f0547df85745ba091e1907385f88776249e9418307',
  },
  {
    id: '0x43c152b2f4a19dc464f9ab523bee29b98c48c9e36c9c709e59b43ec913643608',
    account: '0xe0a171587b1cae546e069a943eda96916f5ee977',
    action: {
      id: '0x38f12558087095621293389b35508390a03d17855b55b2394ce67b3c47d4463d',
    },
    txHash: '0xff9653677fca74cbef95289e9fb4b65198378b8ac70447c515e058eda5b14dce',
  },
  {
    id: '0x459c6b8efea3901f2395d2608c9a487bbe56c27831d5be286880cda9d95ddea6',
    account: '0x3b1836c09fdae0a7c2848f99b2584aebd6a36876',
    action: {
      id: '0xce5365a1997f2bf34c1961ac02d4bf6ad23b9f44d4c14a217a4df348b0dfd4cf',
    },
    txHash: '0xfcd0056a75ebfbdd0437ce1b2eadf8a00252dc1d136c41ca5d764e438e6a1b1d',
  },
  {
    id: '0x4953cbf546bb9c17c13c560649f70db9cbdacfc696a48a10fa5dbd6cc3863da0',
    account: '0x7b9b6f094dc2bd1c12024b0d9cc63d6993be1888',
    action: {
      id: '0xeba777d811cd36c06d540d7ff2ed18ed042fd67bbf7c9afcf88c818c7ee6b498',
    },
    txHash: '0x2b1518b6d15ef31b2f83669c7bd4da7b7feb01b77657d8d5df519467cbabe063',
  },
  {
    id: '0x49bff2ca3507899f3cd717f900c4c1827faa774f6bda690951a2730fd5e80d09',
    account: '0x03f1ab8b19bce21eb06c364aec9e40322572a1e9',
    action: {
      id: '0xc149e88b59429ded7f601ab52ecd62331cac006ae07c16543439ed138dcb8d34',
    },
    txHash: '0x79102fe6eb2ddddbd19801b99e1438635d14196806420150115ecf6f4e9ccb22',
  },
  {
    id: '0x522cd8f2513215118a65f4b37808b044e27d4af633a664fc67e3b4e9b64d6a38',
    account: '0x03f1ab8b19bce21eb06c364aec9e40322572a1e9',
    action: {
      id: '0x78ad1b68d148c070372f8643c4648efbb63c6a8a338f3c24714868e791367653',
    },
    txHash: '0x79102fe6eb2ddddbd19801b99e1438635d14196806420150115ecf6f4e9ccb22',
  },
  {
    id: '0x53f73bc4a93be751fb587fa4d04a8446bcb4c3fb85b19aeb955ab348fa1f2aa0',
    account: '0x3b1836c09fdae0a7c2848f99b2584aebd6a36876',
    action: {
      id: '0x5e7938ef4e6a59634c9800645277831eda1a30b5efd9ec55235154211f9e2941',
    },
    txHash: '0xa7591499e4495d65c277edd72c7e246a279c243b9c96182e4605136b1ed49a95',
  },
  {
    id: '0x54117a9a23dcb2b1598e10da7037c7dc1f061c60562dfd69c6398ada079c5999',
    account: '0x4b1635c7d3d1fc353298f92083e82df69e1e9158',
    action: {
      id: '0x78ad1b68d148c070372f8643c4648efbb63c6a8a338f3c24714868e791367653',
    },
    txHash: '0x8017dc0e1700b99eccc3f0b67a9266cccd5cb46bb237f725510d70b3329f0934',
  },
  {
    id: '0x5a43321fae7560d33ff829af05ec030eef3b271f9231fcedf857444bf507a1f8',
    account: '0x3babebfd684506a5b47701ee231a53427ad413ef',
    action: {
      id: '0xfa01325e2a9c77cda6b403aebfca7b8308d967df009e17ac6b42ba6d18088cfd',
    },
    txHash: '0xfe7eff0251d797eb3708b25c5af5a4f3c753ccf91842b8d46dddd6d6d21d9d12',
  },
  {
    id: '0x640c3c8cf1885235e934ada7ef07fa5e3f09bea112b408e026902640e0874cd9',
    account: '0x2fb8ad26fadc971464a17407e9213d1a22befc8a',
    action: {
      id: '0x7b8a1d293670124924a0f532213753b89db10bde737249d4540e9a03657d1af0',
    },
    txHash: '0xef939986bea3a1c65a9b96a9bdd87ec2a244fac4fc37e41d6a1aecfa0b4acf90',
  },
  {
    id: '0x645d1ef866374bade431fdc2ecb257732def7ef13813621ef01e7855b9e366b4',
    account: '0x7b9b6f094dc2bd1c12024b0d9cc63d6993be1888',
    action: {
      id: '0x7b8a1d293670124924a0f532213753b89db10bde737249d4540e9a03657d1aff',
    },
    txHash: '0x737deb63336a007f7283437e6c05e7877ad1c65554f2002a7dfa8bed63e3301b',
  },
  {
    id: '0x64a815f53a4721f1df3d2d2deb59ed3d22a27459a934f9d1971f92e92ed359bd',
    account: '0x171c0ff5943ce5f133130436a29bf61e26516003',
    action: {
      id: '0x0000000000000000000000000000000000000000000000000000000000000000',
    },
    txHash: '0x6260f3974f7cd6a8dd44193096c78b6f542404df52932ca5273063421e84de7c',
  },
  {
    id: '0x669eee0e9d74014d869f2ed8333a4f56e5f40c36b159e59ef973793707976f1f',
    account: '0x00e695aa8000df01b8dc8401b4c34fba5d56bbb2',
    action: {
      id: '0xc149e88b59429ded7f601ab52ecd62331cac006ae07c16543439ed138dcb8d34',
    },
    txHash: '0xc182a8d8f5c3abfb11dda5ab860afe0684fdc64691161842e54d7af252445881',
  },
  {
    id: '0x70d1b78a0c114aba28d3d8e6203b3e135c0019a8ed5aa5307760546f2036db74',
    account: '0xe0a171587b1cae546e069a943eda96916f5ee977',
    action: {
      id: '0x75f03d945d74639aa78784e5071604aa86c170a9f4c32bdf428231d560be70b7',
    },
    txHash: '0x3d2ac5880a7cd6d7ab2076c4400a6e043e5b81049f056492a3330e9c389ce6c5',
  },
  {
    id: '0x71a19956700f5bdf589257d923d90c0a6e37a5a58e1db02bc3d67514bbc08e94',
    account: '0x2fb8ad26fadc971464a17407e9213d1a22befc8a',
    action: {
      id: '0x78ad1b68d148c070372f8643c4648efbb63c6a8a338f3c24714868e791367653',
    },
    txHash: '0x95e1ac9a704e7c903a36e6d35894f4e2aa4518c69bc3a4cf1fdcc62ce8502e9b',
  },
  {
    id: '0x73a41ffeae15b5abf1e3eea3e46a52469d9e98766e063655fc9e471665f1f3c8',
    account: '0x00e695aa8000df01b8dc8401b4c34fba5d56bbb2',
    action: {
      id: '0x78ad1b68d148c070372f8643c4648efbb63c6a8a338f3c24714868e791367653',
    },
    txHash: '0x17c9446a90ca686c35efb177266d33610674a618af13aa3f1c482429f2737256',
  },
  {
    id: '0x749395e623154e9c276b89bc2bdf94ba41f9ed06e81142f31a0a1139fe602e6d',
    account: '0xdf0399539a72e2689b8b2dd53c3c2a0883879fdd',
    action: {
      id: '0x2315d78651468c46e4eb3cfca481a165fc94d355f1e38cb4e8c60fefdda8f86b',
    },
    txHash: '0x3d2ac5880a7cd6d7ab2076c4400a6e043e5b81049f056492a3330e9c389ce6c5',
  },
  {
    id: '0x760550e5080837019f40a95d7ac09dc1ec307cf65caca6741fc25f8986ca9d61',
    account: '0xe0a171587b1cae546e069a943eda96916f5ee977',
    action: {
      id: '0xde60916cf9b3b92856551e42810a66cb98fdcb8d645bb8bc4632f98217edaf4f',
    },
    txHash: '0xb5afe57b38fde8920ec9d4e90e2af862a8db6317bc174b600aa39a69fe753f53',
  },
  {
    id: '0x7d59f3a34f9b5c31437b879c3053d5925d864df4a23cde6e52f36e54286b281f',
    account: '0x03f1ab8b19bce21eb06c364aec9e40322572a1e9',
    action: {
      id: '0x1282ab709b2b70070f829c46bc36f76b32ad4989fecb2fcb09a1b3ce00bbfc30',
    },
    txHash: '0x79102fe6eb2ddddbd19801b99e1438635d14196806420150115ecf6f4e9ccb22',
  },
  {
    id: '0x7da2369a447f45f0865d18989e92b619c158c97a1a422453376b3077e6efe7db',
    account: '0x00e695aa8000df01b8dc8401b4c34fba5d56bbb2',
    action: {
      id: '0xeba777d811cd36c06d540d7ff2ed18ed042fd67bbf7c9afcf88c818c7ee6b498',
    },
    txHash: '0x4e1a71cd15c0124265e9c686c8af9fc84c3fcefade60d416f7fccb1b11ca1078',
  },
  {
    id: '0x804cc7b62e3fec6255b29853a7b97c71ada631b9739b59005b280cf16b350ba9',
    account: '0xe0a171587b1cae546e069a943eda96916f5ee977',
    action: {
      id: '0xb0f6952d18a23822467f133002cf1bf129c2825a911874b6e1d3cf59ab0d514e',
    },
    txHash: '0xa680d6e22a3713f075cf158f32acc4da91f382fb4b0e366788034406fc52428f',
  },
  {
    id: '0x835f83e8963a7b4778701a2e41d937723232552a39c46f9b42ddc5cc727850f8',
    account: '0x7b9b6f094dc2bd1c12024b0d9cc63d6993be1888',
    action: {
      id: '0x0014a06d322ff07fcc02b12f93eb77bb76e28cdee4fc0670b9dec98d24bbfec8',
    },
    txHash: '0x737deb63336a007f7283437e6c05e7877ad1c65554f2002a7dfa8bed63e3301b',
  },
  {
    id: '0x86b12ee267fd8b970f1e40408b17eb886febb84817a0dd615ac4cb07e5a16d0b',
    account: '0xe9b190404d42784d5c9de20032af43133bd28c28',
    action: {
      id: '0x40b63abf617c319059e63b6ca5293a8551ac35d578bfcf576b5cb81d32823bc0',
    },
    txHash: '0x3b08acd8f28757dabcff50901d6d5edfbb21f164e0f546d6bbdd58e812b585eb',
  },
  {
    id: '0x8dfe3f4af013704db0ffd1631c664c744dc3bbbf7d9564573a47194349fa1089',
    account: '0x171c0ff5943ce5f133130436a29bf61e26516003',
    action: {
      id: '0x552cf8a9722ea54b6fc81eef9df54cbbb0bdd80c1bdacf23d965b7bf7bd9f431',
    },
    txHash: '0x7787d3473cb9e8826a9495217f1d27105c4a86a847e1fd051de6cb05a2f99f43',
  },
  {
    id: '0x8e80d2565533f4279f4e395df6ed37ec5274decd7938dc5d8eaf324b6d63453c',
    account: '0xe0a171587b1cae546e069a943eda96916f5ee977',
    action: {
      id: '0x6b5e3750e9adcbd4a75428ed3fc6d2d3fc8a52866660ad3778d3f8c33108edff',
    },
    txHash: '0x3d2ac5880a7cd6d7ab2076c4400a6e043e5b81049f056492a3330e9c389ce6c5',
  },
  {
    id: '0x93bea003357772d515dc644aa34090e68ff8fba050311fc9edaf1a7fd94709d9',
    account: '0xc92e8bdf79f0507f65a392b0ab4667716bfe0110',
    action: {
      id: '0xeba777d811cd36c06d540d7ff2ed18ed042fd67bbf7c9afcf88c818c7ee6b498',
    },
    txHash: '0xc8d38f1cf55ad39528e3b982dffec303553be87f175dfc0aa034dfa990e96eae',
  },
  {
    id: '0x94e09b684e2b7494ae495971a995f54576409afee05efa6a61f06b2fda6c04ff',
    account: '0x0000a3b4db46aed2e20255f08557e9ba98a0c966',
    action: {
      id: '0x0000000000000000000000000000000000000000000000000000000000000000',
    },
    txHash: '0x64b8eadc875a8613f5835c7f115314a10226240eb24f067d4bd823f89daa418b',
  },
  {
    id: '0x9788085397749e2d71c5320428f607bbbf6cd943d2b193027c28fc5cce4ffe55',
    account: '0xe0a171587b1cae546e069a943eda96916f5ee977',
    action: {
      id: '0x40b63abf617c319059e63b6ca5293a8551ac35d578bfcf576b5cb81d32823bc0',
    },
    txHash: '0x03cbfb3a248cd920852da777ceb000a03e4ffd655eee6740a8a21f5ff6091aad',
  },
  {
    id: '0x9d89b6932687db152aef4b586116cf033f9eb6d1bef090987e960ef09c9ab6c8',
    account: '0x2fb8ad26fadc971464a17407e9213d1a22befc8a',
    action: {
      id: '0xc149e88b59429ded7f601ab52ecd62331cac006ae07c16543439ed138dcb8d34',
    },
    txHash: '0xaa9627298193969232392592889f6687296f34361f6c6df51eded61d7e5caa4f',
  },
  {
    id: '0xa1b8a00d0acd6b76b98f143408da5f215281f71b988d821c2ad3219b63d7f13c',
    account: '0x10ede1ab2ec74d261c15ea02926d5a4e868c8f76',
    action: {
      id: '0x05a6026e8447722ad2634c95e7a4e6321fbe41e0b19b632c7da35e2cf334f03d',
    },
    txHash: '0x33561e70d5083c24d5785faf125ca07c042cc519863cff541fe47b5ad04df0f9',
  },
  {
    id: '0xa4f30c57fc058e2a53089aefc5b2b2d27940e453d6d16127fe551c61b8589115',
    account: '0xe0a171587b1cae546e069a943eda96916f5ee977',
    action: {
      id: '0x518e42b5077d93c9686c907c98cefb63fc94601083a71f03edec50a40ff5ef62',
    },
    txHash: '0x3872efa061566f3fd285b7a712b583e3cb72fcab0f932fa3043c10acfc3fc429',
  },
  {
    id: '0xae31e1218582786cea31f13a25a2de4783cbd62d0f734f58b34ff0d34e0c23e3',
    account: '0xe0a171587b1cae546e069a943eda96916f5ee977',
    action: {
      id: '0xa7bbb6bfa6fb1edcac4443deaa3585deed2396db466176b580b40ff3403ee8b4',
    },
    txHash: '0x3d2ac5880a7cd6d7ab2076c4400a6e043e5b81049f056492a3330e9c389ce6c5',
  },
  {
    id: '0xb3cda9a31a71effe86ad8d569bf0b6715d4fa2172df9c226c757c15bd1f8a01e',
    account: '0xe0a171587b1cae546e069a943eda96916f5ee977',
    action: {
      id: '0x152991b33a10294e25bee98ea5904acd66ba104e55686c0e5c2b7c60c8b5587a',
    },
    txHash: '0x2e40675d875f177ca088375b43dce9647ffcc40e465e3886a1bd2c88d965646a',
  },
  {
    id: '0xbdc6c9c79ba7d2a0c1a210d0a6db04f85e2ad70331c36595f54a81a75b8f602a',
    account: '0x7b9b6f094dc2bd1c12024b0d9cc63d6993be1888',
    action: {
      id: '0x78ad1b68d148c070372f8643c4648efbb63c6a8a338f3c24714868e791367653',
    },
    txHash: '0x737deb63336a007f7283437e6c05e7877ad1c65554f2002a7dfa8bed63e3301b',
  },
  {
    id: '0xbf0d731e6278bce751a51ce70675fa8a2b8919b6f7a2c75513906d2f7958c1ab',
    account: '0xe0a171587b1cae546e069a943eda96916f5ee977',
    action: {
      id: '0xd05e92727c3137b6414e73900467692daf41d632b51b799fbfed05899bff5e4a',
    },
    txHash: '0x92a5a28650cfa54789551fdd104dd9de88e15bcd42a2530c9d8c4324b2e2d0d1',
  },
  {
    id: '0xc29d914cdebb8afaece8af78ab471f079168aa15bcff44f9f8bf5640948d2864',
    account: '0xe0a171587b1cae546e069a943eda96916f5ee977',
    action: {
      id: '0xbc0b729159c77668a876ba12976d49c499667d908b035c2a559771c52de48d39',
    },
    txHash: '0x3d2ac5880a7cd6d7ab2076c4400a6e043e5b81049f056492a3330e9c389ce6c5',
  },
  {
    id: '0xc43d73faf09e5a921177cdfa8ed4f2442f06bc76bafaa12c38b4939c8f027bec',
    account: '0x10a19e7ee7d7f8a52822f6817de8ea18204f2e4f',
    action: {
      id: '0x552cf8a9722ea54b6fc81eef9df54cbbb0bdd80c1bdacf23d965b7bf7bd9f431',
    },
    txHash: '0x0dd4c07bdba9d4ae977e43ee2d784722a1f5b26c4547379d29e708460123658c',
  },
  {
    id: '0xd3666d80dd57806d9d7dc98a8d699e4071a2fa862bf55156e8cb365df4f300aa',
    account: '0x3babebfd684506a5b47701ee231a53427ad413ef',
    action: {
      id: '0x552cf8a9722ea54b6fc81eef9df54cbbb0bdd80c1bdacf23d965b7bf7bd9f431',
    },
    txHash: '0xfe7eff0251d797eb3708b25c5af5a4f3c753ccf91842b8d46dddd6d6d21d9d12',
  },
  {
    id: '0xd3faa89955c4849f4cdf0a816d2074173f4eb7e5bc47afcefe2918d8e85b02d3',
    account: '0x03f1ab8b19bce21eb06c364aec9e40322572a1e9',
    action: {
      id: '0x0014a06d322ff07fcc02b12f93eb77bb76e28cdee4fc0670b9dec98d24bbfec8',
    },
    txHash: '0x79102fe6eb2ddddbd19801b99e1438635d14196806420150115ecf6f4e9ccb22',
  },
  {
    id: '0xdf88e29d8c178bfc181bd582ad0971ba90d2bc1b9766c948675c3e0726cc8ec8',
    account: '0xc92e8bdf79f0507f65a392b0ab4667716bfe0110',
    action: {
      id: '0x1282ab709b2b70070f829c46bc36f76b32ad4989fecb2fcb09a1b3ce00bbfc30',
    },
    txHash: '0xc8d38f1cf55ad39528e3b982dffec303553be87f175dfc0aa034dfa990e96eae',
  },
  {
    id: '0xebe65f08d697479935a9a87d9c33a16cee56f5b5965316a08cdce75a0d35fd45',
    account: '0x00e695aa8000df01b8dc8401b4c34fba5d56bbb2',
    action: {
      id: '0x7b8a1d293670124924a0f532213753b89db10bde737249d4540e9a03657d1aff',
    },
    txHash: '0x4e1a71cd15c0124265e9c686c8af9fc84c3fcefade60d416f7fccb1b11ca1078',
  },
  {
    id: '0xec70f52d9ded31e22a2d0e86c55c0f8ce59113748b94722e911f8f88e084f5c4',
    account: '0x7b9b6f094dc2bd1c12024b0d9cc63d6993be1888',
    action: {
      id: '0x1282ab709b2b70070f829c46bc36f76b32ad4989fecb2fcb09a1b3ce00bbfc30',
    },
    txHash: '0x737deb63336a007f7283437e6c05e7877ad1c65554f2002a7dfa8bed63e3301b',
  },
  {
    id: '0xee46d55032aeffcd16fab472298202be13d40127fde9c74ccc538ea6a41f56e4',
    account: '0x00e695aa8000df01b8dc8401b4c34fba5d56bbb2',
    action: {
      id: '0x0014a06d322ff07fcc02b12f93eb77bb76e28cdee4fc0670b9dec98d24bbfec8',
    },
    txHash: '0x4e1a71cd15c0124265e9c686c8af9fc84c3fcefade60d416f7fccb1b11ca1078',
  },
  {
    id: '0xf022e2f2466ec1fc146121bd2255903901aaf7e437e839815c7ce9e89a82323b',
    account: '0x2fb8ad26fadc971464a17407e9213d1a22befc8a',
    action: {
      id: '0xeba777d811cd36c06d540d7ff2ed18ed042fd67bbf7c9afcf88c818c7ee6b498',
    },
    txHash: '0x8796f9432b2be267c45d90528847f56812ad9889af5473117aa36257263872e9',
  },
  {
    id: '0xf5592629d54c91c5b2a71b8170e0c40e005ac50361df3b15d00e781a85b9aa96',
    account: '0x0df18b22fb1dd4c1d4bfbf783a8acf0758979328',
    action: {
      id: '0xf0a77343972ffaea6782864c7880d1cee9576736637f7702cb0a922223208118',
    },
    txHash: '0x3d2ac5880a7cd6d7ab2076c4400a6e043e5b81049f056492a3330e9c389ce6c5',
  },
  {
    id: '0xf901847778347508dad22263fae0325fef264af513329c3accb7b1f7bad23cbd',
    account: '0x2fb8ad26fadc971464a17407e9213d1a22befc8a',
    action: {
      id: '0x0014a06d322ff07fcc02b12f93eb77bb76e28cdee4fc0670b9dec98d24bbfec8',
    },
    txHash: '0x022d905489a2b04d48340f9283ed6fd99994d0467a62cdb2d66272e8640dbe53',
  },
  {
    id: '0xfbcd877a9572441db642e94dde0cad4eb9ae31d74a2426d77333ad8d75c4a52e',
    account: '0x03f1ab8b19bce21eb06c364aec9e40322572a1e9',
    action: {
      id: '0x7b8a1d293670124924a0f532213753b89db10bde737249d4540e9a03657d1aff',
    },
    txHash: '0x79102fe6eb2ddddbd19801b99e1438635d14196806420150115ecf6f4e9ccb22',
  },
];

export const GrantDelays: DelayData[] = [
  {
    actionId: BalancerTokenAdmin.actionId('BalancerTokenAdmin', 'mint(address,uint256)'),
    newDelay: 30 * DAY,
  },
  {
    actionId: GaugeController.actionId('GaugeController', 'add_gauge(address,int128)'),
    newDelay: 14 * DAY,
  },
  {
    actionId: GaugeController.actionId('GaugeController', 'add_gauge(address,int128,uint256)'),
    newDelay: 14 * DAY,
  },
  // BALTokenHolder.withdrawFunds(address, uint256) (veBAL BALTokenHolder)
  // Note this actionId can't be pulled from the json file as the BALTokenHolder is not listed there.
  { actionId: '0x79922681fd17c90b4f3409d605f5b059ffcbcef7b5440321ae93b87f3b5c1c78', newDelay: 7 * DAY },
  {
    actionId: Vault.actionId('Vault', 'setRelayerApproval(address,address,bool)'),
    newDelay: 7 * DAY,
  },
  {
    actionId: Vault.actionId(
      'Vault',
      'batchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool),int256[],uint256)'
    ),
    newDelay: 7 * DAY,
  },
  {
    actionId: Vault.actionId('Vault', 'joinPool(bytes32,address,address,(address[],uint256[],bytes,bool))'),
    newDelay: 7 * DAY,
  },
  {
    actionId: Vault.actionId(
      'Vault',
      'swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)'
    ),
    newDelay: 7 * DAY,
  },
  {
    actionId: Vault.actionId('Vault', 'exitPool(bytes32,address,address,(address[],uint256[],bytes,bool))'),
    newDelay: 7 * DAY,
  },
  {
    actionId: Vault.actionId('Vault', 'manageUserBalance((uint8,address,uint256,address,address)[])'),
    newDelay: 7 * DAY,
  },
];

export const Roles: RoleData[] = theGraphRoles.map((role) => ({
  role: role.action.id,
  grantee: role.account,
  target: EVERYWHERE,
}));

export const Granters: RoleData[] = [];

export const Revokers: RoleData[] = [];

export const ExecuteDelays: DelayData[] = [
  { actionId: Vault.actionId('Vault', 'setAuthorizer(address)'), newDelay: 30 * DAY },
  {
    actionId: SmartWalletChecker.actionId('SmartWalletChecker', 'allowlistAddress(address)'),
    newDelay: 7 * DAY,
  },
  {
    actionId: VotingEscrowDelegationProxy.actionId('VotingEscrowDelegationProxy', 'setDelegation(address)'),
    newDelay: 14 * DAY,
  },
];
