from django.urls import path
from .views import (
    get_renewable_energy_predictions, 
    peertopeer_predictions, 
    solar_recommendations, 
    CreateView, 
    update_record, 
    delete_record, 
    recover_record, 
    CreateViewPeertoPeer,
    peertopeer_records,
    peertopeer_record_detail,
    add_recommendation,
    recommendation_record_detail
)

urlpatterns = [
    path('predictions/<str:target>/', get_renewable_energy_predictions, name='get_predictions'),
    path('peertopeer/', peertopeer_predictions, name='peertopeer_predictions'),
    path('solar_recommendations/', solar_recommendations, name='solar_recommendations'),
    path('create/', CreateView.as_view(), name='insert_actual_data'),
    path('create/peertopeer/', CreateViewPeertoPeer.as_view(), name='insert_actual_data'),
    path('update/<int:year>/', update_record, name='update_record'),
    path('delete/<int:year>/', delete_record, name='delete_record'),
    path('recover/<int:year>/', recover_record, name='recover_record'),
    path('peertopeer/records', peertopeer_records, name='peertopeer_records'),
    path('peertopeer/records/<str:record_id>', peertopeer_record_detail, name='peertopeer_record_detail'),
    path('add/recommendations', add_recommendation, name='recommendation_records'),
    path('add/recommendations/<str:record_id>', recommendation_record_detail, name='recommendation_record_detail')
]