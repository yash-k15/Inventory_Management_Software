
-- Keep the customer-name and exhibition snapshots immutable.
-- Customer merges may still update customer_id.
CREATE TRIGGER trg_order_header_immutable
BEFORE UPDATE ON customer_order
WHEN NEW.customer_name_snapshot <> OLD.customer_name_snapshot
  OR NEW.exhibition_id IS NOT OLD.exhibition_id
BEGIN
    SELECT RAISE(
        ABORT,
        'Order customer and exhibition snapshots cannot be changed'
    );
END;

-- Prevent a cancelled order from being reactivated if one of its
-- selection items has already been assigned to another active order.
CREATE TRIGGER trg_order_selection_unique_on_status_update
BEFORE UPDATE OF status ON customer_order
WHEN NEW.status <> 'Cancelled'
  AND OLD.status = 'Cancelled'
  AND EXISTS (
      SELECT 1
      FROM customer_order_item current_item
      JOIN customer_order_item other_item
        ON other_item.selection_item_id = current_item.selection_item_id
       AND other_item.id <> current_item.id
      JOIN customer_order other_order
        ON other_order.id = other_item.order_id
      WHERE current_item.order_id = NEW.id
        AND current_item.selection_item_id IS NOT NULL
        AND other_order.status <> 'Cancelled'
  )
BEGIN
    SELECT RAISE(
        ABORT,
        'Cannot reactivate this order because a selection item belongs to another active order'
    );
END;
