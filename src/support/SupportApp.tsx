import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, CircleHelp, ClipboardList, Copy, Search, X, Sparkles, Image, Presentation, Paperclip, PanelsTopLeft, UserRound, LifeBuoy, ChevronRight } from 'lucide-react';
import { PrimaryNav } from '../components/PrimaryNav.js';
import { IMAGE_COST } from '../shared/imageSpecs.js';
import { TutorialGuide, tutorialMatches, countMatchingTutorials } from './TutorialGuide.js';
import '../styles/support.css';

type Article = { title: string; paragraphs?: string[]; steps?: string[]; note?: string };
type Topic = { id: string; title: string; description: string; articles: Article[] };
const topics: Topic[] = [
  { id: 'start', title: '开始你的第一次创作', description: '登录账号，选择工具，确认点数，查看作品。', articles: [
    { title: '我应该选择文生图、PPT 还是智能画布？', paragraphs: ['文生图适合制作单张海报、配图、插画等图片，生成后进入独立的图片作品页。PPT 生成适合围绕同一个主题制作一套演示文稿，完成后进入 PPT 工作台。', '智能画布适合把文本与图片放到同一个空间，通过节点连接参考内容，继续生成、编辑和组织创意。模版库提供成套 PPT 视觉参考，技术支持用于查询操作方法。'] },
    { title: '如何登录，以及为什么要先登录？', steps: ['点击顶部“登录”或“注册”，完成账号登录；已登录时通过“个人中心”查看当前账号。', '输入创作需求，选择画质、页数或数量，检查本次消耗。', '点击生成后，在确认框中再次核对点数，确认才会提交。', '完成后到对应作品页或个人中心查看、下载、继续编辑。'], note: '作品和点数属于提交任务时登录的账号。更换账号后只会看到该账号自己的作品。' },
    { title: '怎样写需求，才能获得更准确的结果？', paragraphs: ['说明主题、面向的人群、用途、必要文字和希望表达的重点。例如：“为初次参观城市博物馆的游客制作 8 页导览，介绍参观路线与注意事项，中文标题准确清晰。”', '需要精确呈现的中文、数字、单位、日期和专有名词，请直接写入需求或参考文件。指定必须保留的文字时，可用引号标明。生成完成后仍应核对重要事实和文字。'] },
  ] },
  { id: 'image', title: '文生图：从需求到图片作品', description: '独立结果页展示进度、图片和后续操作。', articles: [
    { title: '文生图的完整操作流程', steps: ['进入“文生图”，输入画面描述；需要参考时添加参考图片。', '选择 2K 或 4K 画质，并根据用途选择横版、竖版或方形等比例。', '查看本次消耗，点击生成并确认。', '在图片作品页查看生成、保存或失败状态；成功后可以下载、删除或放入智能画布继续创作。'] },
    { title: '点击生成以后，结果在哪里？', paragraphs: ['确认生成后会进入独立的图片作品页。页面显示当前进度，成功后展示大图预览。登录账号的生成图片会保存到个人中心的画布素材中。', '在同一浏览器页面内切换导航后，可以返回文生图的作品页查看任务。请等待任务保存完成再关闭浏览器；刷新或关闭页面可能中断尚未完成的文生图请求。'] },
    { title: '图片生成成功，但保存失败怎么办？', paragraphs: ['如果页面已经显示图片，但提示保存失败，使用页面提供的重新保存操作即可。重新保存已有结果不会再次调用生图接口。', '生成本身失败与保存失败是两种不同状态：生成失败需要重新生成；保存失败应先保存已有图片，避免重复消耗。'] },
  ] },
  { id: 'ppt', title: 'PPT：规划、生成与演示', description: '自定义 1–100 页，完成后在工作台浏览和修改。', articles: [
    { title: '如何生成一套 PPT？', steps: ['进入“PPT 生成”，描述主题、受众和用途。', '填写 1–100 的整数页数，选择 2K 或 4K 画质。', '按需添加参考资料、风格参考、Logo，或从模版库选择一个系列。', '可先点击“优化”完善需求；随后点击生成，在确认框核对总消耗。', '任务先分析参考资料并规划各页内容，再生成逐页提示词与页面图片；页面生成最多六路并发。', '在工作台查看缩略图、生成进度和大图。作品会归属当前账号，个人中心可再次打开。'] },
    { title: '“优化”和“内容规划”有什么区别？', paragraphs: ['“优化”发生在提交生成前，用于整理主题和表达要求；有参考资料时会结合正文分析。可以查看优化后的需求并自行调整。', '内容规划发生在生成任务中，负责围绕主题分配各页内容、形成整套文稿结构与逐页提示词。没有点击优化，也会在正式生成时进行规划。排版、配图与视觉表现交给生图模型构建。', '长参考文件需要分段分析，因此比只有一句主题的优化更耗时。请观察进度，避免在等待期间连续提交相同任务。'] },
    { title: '切换页面或关闭浏览器，会中断 PPT 吗？', paragraphs: ['已经成功提交的 PPT 任务由服务器运行。切换到个人中心或其他页面后，仍可返回工作台查看进度。任务提交前的输入、上传和确认操作还不属于后台任务。', '工作台任务区域展示正在生成的任务进度。需要暂停时使用“停止”；服务停止、上游接口异常或任务失败时，请根据提示检查后再重试。'] },
    { title: '如何浏览、局部修改和替换一页？', steps: ['点击左侧缩略图选择页面，也可使用上下或左右方向键翻页；编辑文字时方向键优先用于输入。', '在工作台选择框选或涂抹工具，标记需要修改的区域，并明确写出修改要求。', '确认修改消耗后提交，局部修改以原图为依据，要求保留未标记区域的结构与内容。', '成功后替换当前页面，作品库打开的是更新后的文稿。请检查局部修改结果是否满足需求。'], note: '工作台用于浏览与画板修改；新建文稿请回到“PPT 生成”。' },
    { title: '如何导出与全屏演示？', paragraphs: ['在 PPT 工作台点击“下载 PPTX”。请先完成全部页面；失败页可先重试，完成后再导出。当前 PPTX 使用生成的页面图片制作幻灯片，图片中的文字不能作为独立文本框编辑。', '点击“全屏演示”进入演示视图，使用上下或左右方向键翻页，Esc 退出。若浏览器没有进入原生全屏，可使用页面的演示视图；检查是否允许全屏操作。'] },
  ] },
  { id: 'references', title: '参考资料、Logo 与模版系列', description: '内容依据与视觉参考各有用途，可以组合使用。', articles: [
    { title: '参考文件支持哪些格式？上传后怎样参与规划？', paragraphs: ['正文分析支持 PDF、DOCX、PPTX、XLSX 和文本文件。PPT 页面最多添加 6 个参考资料，单个文件不超过 8MB。', '参考资料用于提取事实、术语、重点和内容结构，随后参与主题优化及生成规划。上传成功不等于正文解析成功：如果提示不支持或解析失败，换成支持格式后重新上传。', '扫描 PDF、纯图片文档或受密码保护的文件可能无法提取正文。建议提供可复制文字的文件，或者把关键内容整理成文本后上传。'] },
    { title: 'Logo 上传和风格参考有什么不同？', paragraphs: ['Logo 用于表达品牌标识，上传前请确认图形完整、边缘清晰。PPT 支持 PNG、JPEG、WebP 或 SVG Logo。', '风格参考支持 PNG、JPEG、WebP 图片，最多 3 张，用于参考配色、版式、材质和视觉表达。它不是事实资料，重要文字与数据仍应写入主题或参考文件。'] },
    { title: '模版库为什么以系列展示？如何使用？', steps: ['进入“模版库”，选择符合需求的系列。一个系列中的多张页面共同表达同一套视觉风格。', '选择该系列作为参考后，进入 PPT 生成页面，检查参考素材已显示。', '填写自己的主题与页数后生成。需要重点延续的配色、标题风格或版式，请在需求中写明。'], note: '模版用于视觉参考，生成内容仍围绕你的主题；模型生成不能保证逐像素复刻所有参考页面。' },
    { title: '上传后名称乱码、看不到正文或上传失败怎么办？', paragraphs: ['文件卡片出现后，检查名称及解析状态。名称显示异常时先核对本地文件名，必要时改为简单的中文或英文名再上传。不要仅凭卡片外观判断正文是否已经被分析。', '检查文件格式与 8MB 大小限制、登录状态和网络连接。移除失败的附件再上传；资料很多时先保留与本次主题最相关的文件。'] },
  ] },
  { id: 'canvas', title: '智能画布：节点与图片编辑', description: '把文本与图片组织在一起，让参考和结果形成工作流。', articles: [
    { title: '如何创建画布并连接参考内容？', steps: ['进入“智能画布”，创建或打开项目，进入全屏画布编辑器。', '使用底部工具栏添加文本、上传图片，并通过连接点建立节点关联。', '在生成节点填写需求，检查引用的文字或图片，选择画质、比例与数量。', '提交前核对确认框中的消耗点数。成功后图片显示在结果节点，保存的素材可在个人中心查看。'], note: '当前画布以文本和图片为核心；视频、音频和 Codex 连接不属于本项目的创作功能。' },
    { title: '如何涂抹或框选局部修改？', steps: ['选中原图，打开图片工具栏中的涂抹编辑功能。', '涂抹或框选要改动的区域，并说明具体改动，例如“删除标记区域内的物体，补全背景”。', '提交时原图与真实蒙版一起发送，输出沿用原图尺寸和比例；未标记区域要求保持一致。', '检查结果，再决定保留、继续修改或删除。重试局部修改时仍以原图和原蒙版为依据。'], note: '参考图中的蓝色标记只用于说明修改范围，完成图中不应保留蓝色标记。' },
    { title: '怎样移动、缩放和管理节点？', paragraphs: ['使用手形工具拖动画布，通过左下角缩放控件调整整体视野。选中节点后可拖动位置，并在节点工具栏查看可用操作。', '图片节点工具栏提供下载、复制、裁剪、分割、局部修改等操作。窄屏时工具栏可横向滚动。裁剪与分割是主动编辑操作，会改变图像范围，请先保留需要的原图。', '节点插件入口可查看当前已安装的插件。不同节点可用的操作不同，以实际工具栏为准。'] },
    { title: '停止生成、重试和删除有什么区别？', paragraphs: ['停止用于结束当前请求；重试会重新提交生成，确认后按对应操作收费。已经生成但未保存的结果，应先尝试保存，避免重复生成。', '删除节点移除画布中的对应内容；生成素材的删除同步到个人中心。清空画布或删除项目影响其中的节点和关联素材，请先检查并下载需要保留的作品。', '画布任务与 PPT 后台任务机制不同。正在生成时建议保留画布页面，等待完成并保存后再关闭浏览器。'] },
  ] },
  { id: 'account', title: '个人中心、作品与会员点数', description: '账号归属、会员有效期和消费记录集中管理。', articles: [
    { title: '我的作品保存在哪里？能否继续编辑或删除？', paragraphs: ['PPT 在个人中心“我的作品”中管理，打开后进入同一套 PPT 工作台。文生图和画布保存的图片、文本在“画布素材”中查看。', '可以从结果页、工作台或个人中心删除对应作品；删除后相关列表同步更新。删除不退回已经完成的生成消耗。被取消或删除的 PPT 任务中，未完成部分的预扣点数按任务结算退回。', '删除后无法通过普通页面恢复，请先下载需要保留的内容。在其他画布项目中已有的引用副本可能仍然保留。'] },
    { title: '本次消耗怎样计算？', paragraphs: ['PPT 每页及普通文生图/画布每张：2K ' + IMAGE_COST['2K'] + ' 点，4K ' + IMAGE_COST['4K'] + ' 点（会员按套餐享受更低的实扣点数，以会员页展示为准）。PPT 总消耗为页数乘以每页点数；多张图片总消耗为数量乘以每张点数。', '图生图与局部重绘按对应画质档位计费。文生图上传参考图后使用图片编辑接口，与所选画质同价。提示词优化每次 1 点，所有用户一致。确认框会展示当前操作的总消耗与余额，请以提交前的确认信息为准。', '免费用户每天可免费生成 3 张 2K 文生图。点数不足时需先补充余额。服务器确认的失败或未完成生成会退回对应的预扣点数，可在个人中心使用记录中核对；已成功生成再删除的作品不退费。'] },
    { title: '已开通会员，为什么不应继续看到“开通会员”？', paragraphs: ['会员套餐、状态与到期时间由服务器保存，并与个人中心、创作页导航和会员中心共用。会员有效期内，导航显示当前套餐，个人中心展示到期时间；到期或取消后显示非会员状态。', '会员资格与点数余额、账号角色独立。充值点数不会自动变成会员，管理员角色也不等于付费会员。', '当前在线支付通道尚未启用。页面选择套餐不会完成付款，也不会自动开通；经确认办理后由管理员登记套餐和有效期。真实支付开通需要后续接入支付及支付成功回调。'] },
    { title: '怎样查看消耗、充值点数和修改账号资料？', paragraphs: ['个人中心“使用记录”可查看近期生成、充值等记录；“点数与充值”展示余额，可输入管理员提供的充值码兑换点数。充值码兑换与会员资格分别管理。', '在“账号资料”修改显示名称和手机号，在“账号安全”验证当前密码后修改登录密码。修改密码会使旧会话失效，请重新登录。'] },
  ] },
  { id: 'troubleshooting', title: '遇到问题时怎么处理', description: '先确认任务状态，再选择恢复、保存或重试。', articles: [
    { title: '显示 Failed to fetch、网络异常或页面打不开', paragraphs: ['先检查网络和登录状态，确认服务地址可以打开。网络错误可能发生在发送请求或接收结果时，不一定表示上游没有生成。', '先查看结果页、工作台进度和个人中心是否已有作品及消耗记录，再决定是否重试。没有状态反馈时记录操作时间、主题、画质和完整报错，交给管理员核对任务与接口日志。', '本站在本地运行时，需要前后端服务保持启动。页面打不开、样式未加载或长时间黑屏，应联系维护人员恢复服务。'] },
    { title: '生成超时或上游已扣费，但我没有看到图片', paragraphs: ['4K、大量页面和复杂参考可能需要更长时间。保持页面连接，先观察任务是否仍在运行。PPT 可返回工作台查看服务端进度。', '上游服务扣费与本站成功接收、保存结果是不同环节。请先查看个人中心和结果页面；若确实没有结果，向管理员提供操作时间和报错，核对返回结果及退回记录。不要因为暂时没看到图片反复点击生成。'] },
    { title: '提示尺寸、比例不匹配，或者画质不符合所选档位', paragraphs: ['本站按所选档位和比例向对应接口请求图片，生成结果采用上游原生画面。系统不会为了通过校验而自动裁剪、拉伸或放大生成图片。', '2K 的实际原生输出会因模型而不同；4K 和局部修改有对应尺寸要求。遇到尺寸或比例错误时，应由管理员核对该档位的接口能力与参数，不要通过改名把较低分辨率结果当作高分辨率结果。'] },
    { title: 'PPT 规划失败或提示未配置模型', paragraphs: ['PPT 需要内容规划模型与生图接口。规划失败时，先检查参考资料是否解析成功；模型未配置、连接失败或上游限流需要管理员处理。', '管理员应分别检查规划模型和 2K / 4K 生图档位的接口地址、模型和连接状态。配置修复后，再在工作台重试失败任务或页面。'] },
    { title: '个人中心找不到作品，或者另一台设备没有同步', paragraphs: ['先确认当前账号与生成时的账号一致，再检查任务是否已完成保存。PPT 看“我的作品”，图片与文本看“画布素材”。', '切换页面或回到浏览器会同步服务器状态，也可以使用个人中心“刷新”按钮更新列表。正在运行、保存失败或尚未提交的内容，不等于已经进入作品库。'] },
    { title: '需要反馈问题，应该提供哪些信息？', paragraphs: ['提供操作页面、发生时间、所选画质/页数/数量、操作步骤，以及完整报错文字或截图。作品或任务标题也能帮助定位。', '不要在反馈中发送密码、API Key 或支付凭据。当前页面提供操作指引，尚未接入在线客服或工单系统；请通过与你联系的产品管理员反馈问题。'] },
  ] },
];

const sections = [
  { id: 'start', label: '创作入门', icon: Sparkles },
  { id: 'ppt', label: 'PPT 生成', icon: Presentation, tutorial: 'ppt', route: '/ppt', action: '制作 PPT' },
  { id: 'image', label: '文生图', icon: Image, tutorial: 'image', route: '/image', action: '生成图片' },
  { id: 'canvas', label: '智能画布', icon: PanelsTopLeft, tutorial: 'canvas', route: '/canvas', action: '进入画布' },
  { id: 'references', label: '资料与模版', icon: Paperclip, tutorial: 'reference', route: '/templates', action: '查看模版库' },
  { id: 'account', label: '作品与账号', icon: UserRound, tutorial: 'works', route: '/account', action: '查看我的作品' },
  { id: 'troubleshooting', label: '问题排查', icon: LifeBuoy },
];

export const SupportApp: React.FC = () => {
  const [search, setSearch] = useState('');
  const [active, setActive] = useState('ppt');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const feedbackChecklist = '操作页面：\n发生时间：\n作品或任务标题：\n画质 / 页数 / 数量：\n操作步骤：\n报错文字（请附截图）：\n请勿填写密码、API Key 或支付凭据。';
  const copyChecklist = async () => {
    try {
      await navigator.clipboard.writeText(feedbackChecklist);
      if (mounted.current) setCopyState('copied');
    } catch {
      if (mounted.current) setCopyState('manual');
    }
  };
  const content = useRef<HTMLDivElement>(null);
  const selectSection = (id: string) => {
    setActive(id);
    setSearch('');
    if (content.current && content.current.getBoundingClientRect().top < 90) content.current.scrollIntoView({ block: 'start' });
  };
  const query = search.trim().toLocaleLowerCase();
  const results = useMemo(() => sections.map(section => {
    const topic = topics.find(item => item.id === section.id)!;
    const articles = topic.articles.filter(article => !query || [topic.title, article.title, ...(article.paragraphs || []), ...(article.steps || []), article.note || ''].join(' ').toLocaleLowerCase().includes(query));
    return { ...topic, ...section, articles, showTutorial: !!section.tutorial && tutorialMatches(section.tutorial, query) };
  }).filter(section => section.articles.length || section.showTutorial), [query]);
  const visible = query ? results : results.filter(section => section.id === active);
  const count = results.reduce((total, section) => total + section.articles.length, 0);
  const tutorialCount = results.reduce((total, section) => total + (section.tutorial ? countMatchingTutorials(section.tutorial, query) : 0), 0);
  return <div className="support-app celano-page-surface"><PrimaryNav active="support" /><main className="support-main celano-feature-main">
    <header className="support-hero">
      <div className="support-hero-copy">
        <h1>技术支持</h1>
        <p className="support-intro">看清当前状态，让创作继续。</p>
      </div>
      <div className="support-search-wrap">
        <div className="support-search"><Search size={18} /><input aria-label="搜索技术支持" placeholder="搜索参考文件、涂抹修改、点数或生成失败…" value={search} onChange={event => setSearch(event.target.value)} />{search ? <button aria-label="清空搜索" onClick={() => setSearch('')}><X size={16} /></button> : null}</div>
        <div className="support-search-terms" aria-label="热门问题">{['保存失败', '参考文件', '点数', '局部修改'].map(term => <button key={term} type="button" onClick={() => setSearch(term)}>{term}</button>)}</div>
      </div>
    </header>
    <div className="support-quickbar" aria-label="常见入口">
      <span className="support-quick-label">从这里开始</span>
      <button type="button" onClick={() => selectSection('image')}>图片保存失败 <ChevronRight size={13} /></button>
      <button type="button" onClick={() => selectSection('references')}>参考文件解析 <ChevronRight size={13} /></button>
      <button type="button" onClick={() => selectSection('troubleshooting')}>生成超时 <ChevronRight size={13} /></button>
    </div>
    <div className="support-layout">
      <aside className="support-index">
        <nav className="support-sections" aria-label="按功能查看技术支持"><h2>创作指南</h2>{sections.map(section => { const Icon = section.icon; return <button key={section.id} type="button" aria-current={!query && active === section.id ? 'true' : undefined} onClick={() => selectSection(section.id)}><Icon size={17} /><span>{section.label}</span><ChevronRight size={14} /></button>; })}</nav>
        <div className="support-checkpoint"><LifeBuoy size={18} /><h3>先确认，再重试</h3><p>已经看到图片？先尝试保存。没有结果？核对任务状态与消耗记录。</p><button type="button" onClick={() => selectSection('troubleshooting')}>查看排查建议 <ArrowRight size={14} /></button></div>
      </aside>
      <div className="support-content" ref={content}>
        {query ? <p className="support-search-count" role="status">搜索“{search.trim()}”：{count} 条说明 · {tutorialCount} 篇图文教程</p> : null}
        {visible.map(section => <section className="support-topic" key={section.id} aria-labelledby={'support-' + section.id}>
          <header><div><h2 id={'support-' + section.id}>{section.title}</h2><p>{section.description}</p></div>{section.route ? <a className="support-feature-link" href={'#' + section.route}>{section.action}<ArrowRight size={14} /></a> : null}</header>
          {section.showTutorial && section.tutorial ? <TutorialGuide id={section.tutorial} query={query} /> : null}
          {section.articles.length ? <div className="support-articles"><p className="support-articles-label">{section.showTutorial ? '操作细节与相关问题' : '详细说明'}<span>{section.articles.length} 条</span></p>{section.articles.map(article => <details key={query + article.title} open={query ? true : undefined}><summary>{article.title}</summary><div className="support-answer">{article.paragraphs?.map(text => <p key={text}>{text}</p>)}{article.steps ? <ol>{article.steps.map(text => <li key={text}>{text}</li>)}</ol> : null}{article.note ? <p className="support-note">{article.note}</p> : null}</div></details>)}</div> : null}
        </section>)}
        {!visible.length ? <div className="support-empty"><CircleHelp size={24} /><h2>没有找到相关说明</h2><p>试试“上传”“图片”“会员”或“失败”等关键词。</p><button onClick={() => setSearch('')}>清空搜索</button></div> : null}
      </div>
    </div>
    <footer className="support-footer">
      <div className="support-feedback-title"><ClipboardList size={21} /><div><h2>让问题更容易被定位。</h2><p>整理这些信息，通过现有联系渠道交给产品管理员。</p></div></div>
      <ul className="support-feedback-fields"><li>操作页面与发生时间</li><li>任务标题与画质设置</li><li>操作步骤与报错截图</li></ul>
      <div className="support-feedback-actions"><button type="button" onClick={copyChecklist}>{copyState === 'copied' ? <Check size={15} /> : <Copy size={15} />}{copyState === 'copied' ? '已复制反馈清单' : '复制反馈清单'}</button><p role="status">{copyState === 'manual' ? '无法复制，请选择下方清单并复制。' : '请勿发送密码、接口密钥或支付凭据。'}</p></div>
      {copyState === 'manual' ? <textarea className="support-feedback-fallback" aria-label="反馈清单" readOnly value={feedbackChecklist} onFocus={event => event.currentTarget.select()} /> : null}
    </footer>
  </main></div>;
};
