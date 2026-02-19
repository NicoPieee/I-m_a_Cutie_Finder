// CardGrid.jsx
import './CardGrid.css';

export default function CardGrid({ cards, onSelect }) {
  return (
    <div className="card-grid-5x2">
      {cards.map(card => (
        <div
          key={card.id}
          className="yuru-card"
          onClick={() => onSelect(card.id)}
        >
          <img src={card.imageUrl} alt={card.name} />
          <div className="yuru-card-name">{card.name}</div>
        </div>
      ))}
    </div>
  );
}
