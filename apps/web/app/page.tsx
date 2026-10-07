const conversations = [
  { name: "Maria Silva", message: "Quero saber mais sobre os valores", unread: 2, time: "15:42" },
  { name: "Carlos Souza", message: "Obrigado!", unread: 0, time: "15:18" },
  { name: "Ana Lima", message: "Pode me enviar as opções?", unread: 1, time: "14:55" },
  { name: "João Santos", message: "Vou verificar e retorno", unread: 0, time: "14:31" }
];

export default function Home() {
  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">W</div>
          <div>
            <strong>Whats BS</strong>
            <span>Manager</span>
          </div>
        </div>

        <nav>
          <button className="navItem active">Conversas <span>3</span></button>
          <button className="navItem">Contatos</button>
          <button className="navItem">Campanhas</button>
          <button className="navItem">Templates</button>
          <button className="navItem">Relatórios</button>
        </nav>

        <div className="connection">
          <i />
          WhatsApp conectado
        </div>
      </aside>

      <section className="conversationList">
        <header>
          <div>
            <p className="eyebrow">Caixa de entrada</p>
            <h1>Conversas</h1>
          </div>
          <button className="iconButton">+</button>
        </header>

        <label className="search">
          <span>⌕</span>
          <input placeholder="Buscar conversa..." />
        </label>

        <div className="filters">
          <button className="filter active">Todas</button>
          <button className="filter">Não lidas</button>
          <button className="filter">Minhas</button>
        </div>

        <div className="conversationItems">
          {conversations.map((item, index) => (
            <article className={`conversationItem ${index === 0 ? "selected" : ""}`} key={item.name}>
              <div className="avatar">{item.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div>
              <div className="conversationCopy">
                <div className="conversationTop">
                  <strong>{item.name}</strong>
                  <time>{item.time}</time>
                </div>
                <p>{item.message}</p>
              </div>
              {item.unread > 0 && <span className="badge">{item.unread}</span>}
            </article>
          ))}
        </div>
      </section>

      <section className="chat">
        <header className="chatHeader">
          <div className="contactIdentity">
            <div className="avatar large">MS</div>
            <div>
              <strong>Maria Silva</strong>
              <span>online recentemente</span>
            </div>
          </div>
          <div className="chatActions">
            <button>🔍</button>
            <button>⋯</button>
          </div>
        </header>

        <div className="messages">
          <div className="dayDivider"><span>Hoje</span></div>
          <div className="bubble incoming">
            Oi! Vi a mensagem de vocês e quero saber mais.
            <small>15:39</small>
          </div>
          <div className="bubble outgoing">
            Olá, Maria! Claro. Posso te explicar todas as opções por aqui.
            <small>15:40 ✓✓</small>
          </div>
          <div className="bubble incoming">
            Queria entender principalmente os valores e como funciona.
            <small>15:42</small>
          </div>
        </div>

        <footer className="composer">
          <button>＋</button>
          <input placeholder="Digite uma mensagem..." />
          <button className="send">➤</button>
        </footer>
      </section>

      <aside className="contactPanel">
        <div className="contactHero">
          <div className="avatar xlarge">MS</div>
          <h2>Maria Silva</h2>
          <p>+55 48 99999-9999</p>
        </div>

        <div className="infoBlock">
          <span className="sectionLabel">STATUS</span>
          <button className="statusPill">Interessado</button>
        </div>

        <div className="infoBlock">
          <span className="sectionLabel">ETIQUETAS</span>
          <div className="tags">
            <span>Lead</span>
            <span>Paraguai</span>
            <button>+</button>
          </div>
        </div>

        <div className="infoBlock">
          <span className="sectionLabel">RESPONSÁVEL</span>
          <div className="assignee">
            <div className="miniAvatar">IH</div>
            <span>Israel Hespanhol</span>
          </div>
        </div>

        <div className="infoBlock">
          <span className="sectionLabel">JANELA WHATSAPP</span>
          <div className="windowCard">
            <strong>23h 17min restantes</strong>
            <span>Janela de atendimento aberta</span>
          </div>
        </div>

        <button className="detailsButton">Ver dados do contato</button>
      </aside>
    </main>
  );
}
