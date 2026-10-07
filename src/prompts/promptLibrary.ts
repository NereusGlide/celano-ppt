/**
 * 文生图「提示词库」数据。
 *
 * 设计：每条卡片 = 预览图 + 标题 + 分类 + 描述 + 完整提示词 + 一键同款。
 * 参考 awesome-gpt-image-2（CC BY 4.0，社区收集）的「提示词 + 效果图成对」形态，
 * 提示词在录入时已把 Raycast 占位符（{argument name=... default=...}）展开为默认值，
 * 保证「一键同款」填入文生图输入框后可直接生成。
 *
 * image 为可选的效果图 URL；本地网络无法访问 youmind CDN 时，卡片自动降级为
 * category 对应的渐变封面，保证任何环境都不出现裂图。
 */

export interface PromptCategory {
  key: string;
  label: string;
  /** 封面渐变（用于无图 / 图加载失败时的兜底背景） */
  gradient: [string, string];
  /** lucide 图标名，见 PromptLibraryApp 的 ICON 映射 */
  icon: string;
}

export interface PromptCard {
  id: string;
  title: string;
  category: string;
  description: string;
  /** 完整提示词，已展开默认值，可直接用于生图 */
  prompt: string;
  /** 可选效果图 URL（CDN），加载失败自动降级封面 */
  image?: string;
  /** 推荐比例（对齐 IMAGE_SIZE_PRESETS 的合法值） */
  ratio: string;
  source?: string;
}

export const PROMPT_CATEGORIES: PromptCategory[] = [
  { key: 'poster', label: '海报传单', gradient: ['#2f4f96', '#1a88ff'], icon: 'Presentation' },
  { key: 'ecommerce', label: '电商主图', gradient: ['#1b3160', '#7aa2f7'], icon: 'ShoppingBag' },
  { key: 'portrait', label: '人像自拍', gradient: ['#5e3a7a', '#c07adf'], icon: 'UserRound' },
  { key: 'product', label: '产品图', gradient: ['#24407c', '#5e85d6'], icon: 'Package' },
  { key: 'cinematic', label: '电影剧照', gradient: ['#8a4a2a', '#e8a06a'], icon: 'Film' },
  { key: 'anime', label: '动漫漫画', gradient: ['#7a2f5e', '#e06aa8'], icon: 'Sparkles' },
  { key: 'illustration', label: '插画', gradient: ['#2f6a4a', '#6ac08a'], icon: 'PenTool' },
  { key: 'threed', label: '3D 渲染', gradient: ['#3a5e8a', '#7ab0e8'], icon: 'Box' },
  { key: 'pixel', label: '像素艺术', gradient: ['#4a3a8a', '#9a7ae8'], icon: 'Grid3x3' },
  { key: 'watercolor', label: '水彩', gradient: ['#3a7a7a', '#7ad0d0'], icon: 'Droplets' },
  { key: 'ink', label: '水墨中国风', gradient: ['#3a3a3a', '#8a8a8a'], icon: 'Brush' },
  { key: 'cyberpunk', label: '赛博朋克', gradient: ['#1a5e7a', '#4ae0c8'], icon: 'Cpu' },
  { key: 'food', label: '美食饮品', gradient: ['#8a5e2a', '#e8c06a'], icon: 'UtensilsCrossed' },
  { key: 'animal', label: '动物', gradient: ['#6a4a2a', '#c89a6a'], icon: 'PawPrint' },
  { key: 'architecture', label: '建筑室内', gradient: ['#4a4a5e', '#9a9ac0'], icon: 'Building2' },
  { key: 'landscape', label: '风景自然', gradient: ['#2a5e4a', '#6ac88a'], icon: 'Mountain' },
  { key: 'cityscape', label: '城市街景', gradient: ['#3a4a6a', '#8aa0c8'], icon: 'Building' },
  { key: 'typography', label: '文本排版', gradient: ['#5e3a2a', '#c89a6a'], icon: 'Type' },
  { key: 'minimal', label: '极简主义', gradient: ['#3a3a3a', '#9a9a9a'], icon: 'Circle' },
];

const SRC = 'awesome-gpt-image-2（CC BY 4.0）';

export const PROMPT_LIBRARY: PromptCard[] = [
  // ─────────────────────────── 参考仓库精选 ───────────────────────────
  {
    id: 'p-vr-exploded',
    title: 'VR 头显爆炸视图海报',
    category: 'poster',
    description: '高科技 VR 头显爆炸视图，含详细组件标注与宣传文案，3D 渲染 + 摄影棚灯光。',
    prompt:
      '产品爆炸视图海报。主体：VR 头显。风格：简洁的高科技 3D 渲染，摄影棚灯光，发光装饰。背景：柔和的紫蓝色渐变。顶部 logo 为「∞ Meta Quest 3」，副标题「以全新的结构，重塑全新的现实。」。画面中心是 VR 头显的垂直堆叠爆炸视图，展示 9 层内部组件：外壳、摄像头传感器、带芯片的主板、Pancake 透镜、内部框架、电池组、侧带、顶部头带和面部接口衬垫，四周带 8 处标注引线。底部文案区：左侧标题「体验，源于结构的进化。」，正文「每一个零件都蕴含着支撑沉浸式体验的前沿科技与匠心设计。Meta Quest 3 从内部构建未来，为您带来超乎想象的体验。」，右下角为「∞ Meta」标志。',
    image: 'https://cms-assets.youmind.com/media/1776658772018_lukyfw_HGSUfldbIAEiMWZ.jpg',
    ratio: '2:3',
    source: SRC,
  },
  {
    id: 'p-food-map',
    title: '手绘城市美食地图',
    category: 'illustration',
    description: '手绘水彩风格旅游地图，含编号特色美食、地标建筑与图例，复古羊皮纸质感。',
    prompt:
      '手绘地图信息图。风格：复古羊皮纸上的水彩墨水手绘插画。标题：「成都 吃货暴走地图」，吉祥物为戴着墨镜并竖起大拇指的卡通红辣椒。边框装饰为绿叶与红辣椒藤蔓。背景是带有黄色道路、蓝色河流和绿色公园区域的纹理米色羊皮纸。画面包含三个区域：① 地标建筑 6 个（传统凉亭、传统寺院、攀爬熊猫的现代摩天大楼、电视塔、牌坊、工业建筑，标注人民公园/文殊院/IFS/339电视塔/宽窄巷子/东郊记忆）；② 美食地点 12 个（麻婆豆腐、红油水饺、冷锅串串、三大炮、蛋烘糕、九宫格火锅、肥肠粉、钵钵鸡、冒菜、盖碗茶、冰粉、兔头，逐一带编号）；③ 右下角图例（红点=美食、绿色建筑=地标、绿树=公园、蓝线=河流、黄色双线=道路）。中心是一只坐着吃竹子的大熊猫。',
    image: 'https://cms-assets.youmind.com/media/1776662673014_nf0taw_HGRMNDybsAAGG88.jpg',
    ratio: '3:4',
    source: SRC,
  },
  {
    id: 'p-anime-duel',
    title: '动漫武术对决',
    category: 'anime',
    description: '两名少女在传统道场中的激烈武术对决，元素能量特效，极具爆发力的动态构图。',
    prompt:
      '一幅极具动态感的动漫插画，描绘两名少女在传统木质道场内进行激烈武术对决。前景：一名留着黑色高丸子头配红色丝带的少女摆出强有力低位武术架势奋力挥拳，身穿带有红色流苏的白色中式上衣和红色宽松长裤，强烈的红色能量斩击环绕着她挥动的四肢。右侧半空：一名留着浅紫色双丸子头的少女优雅跃起、自信微笑，身穿带有金色刺绣的深绿色连衣裙和黑色紧身裤，伴随扫过的蓝色水流状能量轨迹。背景是质朴的木质寺庙内部，上方悬挂一块写有「武術会」的醒目招牌。画面充满爆发性动作感：飞扬尘土、破碎木质地板、发光彩色粒子特效，以及将角色与背景区分开的戏剧性低角度光影。',
    image: 'https://cms-assets.youmind.com/media/1776756799880_c8u8w7_HGUKjjaasAAvVRa.jpg',
    ratio: '16:9',
    source: SRC,
  },
  {
    id: 'p-purple-portrait',
    title: '紫色头发时尚人像',
    category: 'portrait',
    description: '超写实半身时尚人像，紫罗兰波波头，赤陶色秋日色调，高端时尚摄影质感。',
    prompt:
      '创建一张超写实的半身时尚人像，年轻女性角色，标志性的鲜艳紫罗兰色齐下巴直发波波头、柔和刘海、白皙瓷肌、鼻梁和脸颊上的自然雀斑、淡褐色眼睛、精致五官、光泽嘴唇和苗条身材。她以放松的蹲坐姿势靠在温暖的赤陶色纹理墙边，头部轻轻倚靠在一侧手上，平静而直接地注视镜头。身穿赤陶色锈橙色短款连帽衫、米色高腰工装慢跑裤和棕色系带皮革战斗靴，佩戴图案缎面蝴蝶结发带和橙色蝴蝶发夹。柔和自然日光，温暖大地色秋季色调，亲密编辑风格构图，真实皮肤质感、细节丰富的紫色头发、自然织物和皮革纹理、微妙阴影、电影级景深、照片级真实感、超精细 8K 画质、高端时尚摄影效果。',
    image: 'https://cms-assets.youmind.com/media/1791187629652_j1bdvm_HT1kIXkakAAOuLq.jpg',
    ratio: '3:4',
    source: SRC,
  },
  {
    id: 'p-cat-ear-selfie',
    title: '猫耳针织毛衣自拍',
    category: 'portrait',
    description: '温馨实拍风自拍：猫耳少女在白色猫咪房间弯腰自拍，3:4 竖幅，柔和暖光。',
    prompt:
      '实拍照片：一位戴着猫耳发箍和尾巴的女性，在白色主题猫咪房间内弯腰自拍，位于画面中央。小巧椭圆脸、深棕色大眼睛、细眉、光泽淡桃色嘴唇，柔和微笑，视线通过手机对准镜头；极长深棕色波浪卷发配薄刘海。身穿淡粉色镂空针织长袖连衣裙（深领口、胸前系带、绒球装饰、短款），白色猫形拖鞋，长白灰色猫尾。双膝弯曲、身体前倾，右手持粉色手机壳的手机置于脸前。背景：白色长毛地毯、逗猫棒、白色置物架、桃花枝、装裱猫咪艺术画、猫爬架，地板上有一只白灰色猫咪。柔和暖色室内光从上方及右后方照亮面部与衣物。3:4 竖幅，前置摄像头略低于腰部，从猫耳到拖鞋的全身，焦点集中在面部、手机和猫耳，背景轻微虚化，白色/米色/淡粉色柔和室内色调。',
    image: 'https://cms-assets.youmind.com/media/1791187632580_9ggb72_HTYFsWga0AAEgoS.jpg',
    ratio: '3:4',
    source: SRC,
  },
  {
    id: 'p-evolution-stairs',
    title: '3D 石阶演化信息图',
    category: 'threed',
    description: '平面演化时间轴转化为逼真 3D 石阶信息图，照片级生物渲染 + 侧边栏。',
    prompt:
      '演化时间轴信息图。将平面矢量设计转化为高度逼真的 3D 信息图：平滑坡道替换为逼真的纹理石阶，所有生物升级为照片级真实 3D 渲染。背景为复古纹理羊皮纸。主标题「人类演化」。左侧边栏 8 个层级：单细胞生命、多细胞生物、动物界、脊索动物、上陆革命、哺乳纲、人科演化、智人纪元。右上角「获得的功能 / 失去的功能」图例（加减号图标）。底部中心「演化关键里程碑」时间轴，含 6 个从猿到人的演化剪影。画面中心是蜿蜒石阶，共 25 个编号台阶展示特定生物，关键台阶：第 7 阶水母、第 9 阶菊石、第 10 阶三叶虫、第 24 阶直立行走的人类、第 25 阶带有问号的发光宇宙剪影。',
    image: 'https://cms-assets.youmind.com/media/1776661968404_8a5flm_HGQc_KOaMAA2vt0.jpg',
    ratio: '3:4',
    source: SRC,
  },
  {
    id: 'p-live-ui',
    title: '电商直播 UI 样机',
    category: 'ecommerce',
    description: '逼真直播界面叠加人物肖像，聊天消息、礼物弹窗与商品购买卡片，社媒带货风。',
    prompt:
      '直播 UI 样机。主体：一位面带微笑、身穿印有白色技术示意图的黑色 T 恤的主播肖像。背景左侧是写有「SPACEX」文字的屏幕，右侧是红色「Tesla T logo」和一辆深色汽车。顶部：头像、名称、副标题「55.6万本场点赞」、红色「关注」按钮、金币图标「全站第1名」、观众头像与数字「68.7万」、「更多直播>」「礼物展馆 0/24」。中部左侧礼物：爱心 x1314、火箭 x666。底部左侧聊天区多条弹幕，系统消息「宇宙漫游者 加入了直播间」。右下角商品卡片：橙色「热卖 x 1888」标签、Cybertruck 图片、标题「特斯拉Cybertruck 电动皮卡」、价格「¥ 1,618,000」、红色「抢」按钮、半透明爱心沿右边缘上浮。底部输入栏「说点什么…」+ 笑脸/三点/购物车/礼物盒/分享图标。',
    image: 'https://cms-assets.youmind.com/media/1776699445498_ga2ry5_HGO7H0DWkAApdKK.jpg',
    ratio: '9:16',
    source: SRC,
  },

  // ─────────────────────────── 补充分类 ───────────────────────────
  {
    id: 'p-cyberpunk-alley',
    title: '赛博朋克雨夜小巷',
    category: 'cyberpunk',
    description: '霓虹雨夜的赛博朋克街头，全息广告与湿润地面的反射，电影级氛围。',
    prompt:
      '赛博朋克风格的雨夜小巷。狭窄巷道两侧是高耸的密集建筑，霓虹灯牌与全息广告交错闪烁（青蓝与洋红为主），广告牌上是中日英混合的未来文字。湿滑地面反射霓虹光，形成镜像般的倒影。一名身穿透明雨衣的行人撑着发光伞从巷中走过，背影。远景是巨型摩天楼与飞行器剪影。空气中有细雨与水汽，整体色调冷冽偏青，点缀品红高光，电影级构图，超精细细节，8K 画质，写实与科幻结合。',
    ratio: '9:16',
  },
  {
    id: 'p-minimal-desk',
    title: '极简桌面静物',
    category: 'minimal',
    description: '极简主义桌面静物，柔和自然光，留白充足，高级感。',
    prompt:
      '极简主义桌面静物摄影。一张浅灰色木质桌面上，仅摆放：一个白色陶瓷马克杯、一支哑光黑色钢笔、一张折叠的白纸。物品之间留白充足，构图遵循三分法。柔和的自然侧光从窗边射入，形成柔和的明暗过渡与细腻阴影。背景是干净的白墙，整体色调为白、灰、原木色，静谧高级，超写实，浅景深，4K 质感。',
    ratio: '4:3',
  },
  {
    id: 'p-ink-mountain',
    title: '水墨山水意境',
    category: 'ink',
    description: '中国传统水墨山水，云雾缭绕，留白写意，禅意悠远。',
    prompt:
      '中国传统水墨山水画。远景层峦叠嶂，山体以浓淡不同的墨色晕染，近景一棵苍劲松树。山间云雾缭绕，留白表现出空灵意境。一条小舟与舟上渔翁点缀于江面。画面下方大块留白，右上角题一首小诗与朱红印章。整体墨分五色、笔触写意、气韵生动，仿宋代山水画风格，宣纸质感。',
    ratio: '3:4',
  },
  {
    id: 'p-watercolor-bird',
    title: '水彩花鸟',
    category: 'watercolor',
    description: '清新水彩花鸟画，色彩通透，笔触轻盈。',
    prompt:
      '清新水彩花鸟画。一只蓝色山雀停在一枝盛开的粉色桃花上，羽毛层次分明，色彩通透自然。背景留白，只有淡淡的水彩晕染，体现纸张纹理。水彩的湿润晕开与边缘留白效果，轻盈灵动的笔触，柔和的粉蓝配色，唯美治愈风格。',
    ratio: '1:1',
  },
  {
    id: 'p-pixel-arcade',
    title: '像素风街机小城',
    category: 'pixel',
    description: '复古像素艺术，黄昏街机店与霓虹招牌，16-bit 怀旧感。',
    prompt:
      '复古像素艺术（pixel art）。黄昏时分的街角，一家街机游戏厅门口亮着霓虹招牌「ARCADE」，橱窗透出暖黄灯光。街道、建筑、天空用清晰有限的调色板绘制，像素颗粒感明显，16-bit 复古游戏场景风格。天空是橙紫渐变的晚霞，几颗像素星星点缀。色彩饱和、细节丰富、怀旧氛围，清晰可辨的像素边缘，无模糊。',
    ratio: '16:9',
  },
  {
    id: 'p-city-night',
    title: '城市夜景长曝光',
    category: 'cityscape',
    description: '城市高架夜景长曝光，车流光轨，繁华都市感。',
    prompt:
      '城市夜景长曝光摄影。视角在高架桥上方，桥面车流形成红色与白色的光轨，向远方延伸。两侧高楼灯火通明，远处有地标塔楼。天空深蓝将黑，空气通透。写实摄影风格，长曝光光轨效果，冷暖光对比，丰富细节，电影级构图。',
    ratio: '16:9',
  },
  {
    id: 'p-landscape-lake',
    title: '雪山湖泊晨雾',
    category: 'landscape',
    description: '雪山倒映在湖泊中，晨雾缭绕，风光大片。',
    prompt:
      '风光摄影：清晨的雪山湖泊。雪山尖峰倒映在如镜的湖面上，湖面平静无波，薄雾贴着水面缭绕。前景是几块圆润的卵石与低矮灌木，岸边有淡金色的晨光。天空由淡蓝过渡到暖橙，山体有积雪纹理。超写实，广角构图，通透空气感，8K 细节，国家地理风格风光片。',
    ratio: '21:9',
  },
  {
    id: 'p-interior-wabi',
    title: '侘寂风室内',
    category: 'architecture',
    description: '侘寂风格室内空间，原木、素墙与自然光，宁静质感。',
    prompt:
      '侘寂风格（wabi-sabi）室内设计。一间安静的房间，粗糙质感的白墙，浅色原木地板与家具。一张低矮原木茶几上放着一只手工陶器与一束干花。柔和的自然光透过亚麻窗帘洒入，形成温暖光斑。空间大量留白，质朴、宁静、不完美之美，材质纹理清晰，建筑摄影，超写实，高级感。',
    ratio: '4:3',
  },
  {
    id: 'p-food-ramen',
    title: '日式拉面特写',
    category: 'food',
    description: '热气腾腾的日式拉面特写，诱人质感，商业美食摄影。',
    prompt:
      '商业美食摄影：一碗日式豚骨拉面特写。奶白色浓汤，叉烧肉、溏心蛋、海苔、葱花、笋干码放整齐，面条筋道。热气升腾，汤面泛着油亮光泽。木质托盘与深色背景衬托主体，柔和顶光，浅景深聚焦于食物，诱人食欲，超写实质感，8K 细节。',
    ratio: '1:1',
  },
  {
    id: 'p-product-perfume',
    title: '香水产品图',
    category: 'product',
    description: '高端香水商业产品图，玻璃质感与水花，精致打光。',
    prompt:
      '高端香水商业产品摄影。一支方形玻璃香水瓶置于深色石材台面，瓶身折射出柔和光线，标签精致。背景为深灰渐变，一束聚焦光从侧后方打亮瓶身轮廓，周围点缀飞溅的透明水花与少量花瓣。玻璃质感通透，反射干净利落，高端品牌广告质感，超写实，浅景深，8K 画质。',
    ratio: '1:1',
  },
  {
    id: 'p-animal-fox',
    title: '雪地赤狐',
    category: 'animal',
    description: '雪地中回眸的赤狐，毛发细节清晰，野生动物摄影。',
    prompt:
      '野生动物摄影：一只赤狐站在雪地中回眸。火红蓬松的毛发与洁白雪地形成强烈对比，毛发根根分明，眼神灵动。轻微风雪，狐尾微微扬起，鼻尖与耳朵细节清晰。柔和阴天自然光，浅景深虚化背景雪林，超写实，8K 细节，国家地理风格。',
    ratio: '4:3',
  },
  {
    id: 'p-cinema-noir',
    title: '黑色电影剧照',
    category: 'cinematic',
    description: '黑白黑色电影（film noir）剧照，硬朗阴影与烟雾，悬疑氛围。',
    prompt:
      '黑白黑色电影（film noir）剧照。一个穿长风衣、戴软呢帽的男人站在雨夜街角，半边脸隐在阴影中，硬朗的明暗对比（chiaroscuro）。背景是湿漉漉的街道、昏黄路灯与升腾的烟雾，一束斜射光勾勒出人物轮廓。颗粒质感、高反差、戏剧性构图，经典好莱坞 1940 年代悬疑片氛围。',
    ratio: '3:4',
  },
  {
    id: 'p-typography-poster',
    title: '瑞士网格排版海报',
    category: 'typography',
    description: '瑞士国际主义风格排版海报，严谨网格与大字标题，极简有力。',
    prompt:
      '瑞士国际主义风格（Swiss Style）排版海报。纯色背景（米白），严格的网格布局。超大号无衬线黑色标题字占据画面上方，下方是整齐的信息文字块与细小辅助文字，配一个几何色块（红或蓝）作为视觉焦点。字形清晰锐利，大量留白，对齐精准，理性而现代，平面设计大师作品质感。',
    ratio: '2:3',
  },
  {
    id: 'p-anime-girl',
    title: '吉卜力风少女',
    category: 'anime',
    description: '吉卜力风格的田园少女与天空，温暖治愈的手绘质感。',
    prompt:
      '吉卜力（Ghibli）风格动画场景。一位少女站在一片翠绿的草地上，身后是巨大的积雨云与湛蓝天空，风吹起她的裙摆与草叶。远处有低矮山丘与几座小屋。温暖柔和的自然光，细腻手绘质感，天空层次丰富，白云体积感强，整体治愈、清新、充满夏日气息，电影画面感。',
    ratio: '16:9',
  },
  {
    id: 'p-3d-isometric',
    title: '等距小岛',
    category: 'threed',
    description: '低多边形等距视角小岛，可爱建模与柔和光照。',
    prompt:
      '低多边形（low-poly）3D 渲染，等距视角（isometric）的一座小岛。岛上有几栋彩色小房子、树木、一座灯塔和沙滩。周围是碧蓝海水与几艘小船，云朵悬浮。柔和的光照与淡淡的阴影，色彩清新明快，玩具般的可爱建模，干净平滑的渲染，白色背景留白。',
    ratio: '1:1',
  },
];
